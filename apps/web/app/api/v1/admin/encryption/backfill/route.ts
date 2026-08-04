import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { decryptForTenant, encryptForTenant } from '@/lib/tenant-crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Backfill batches can hit O(thousands) of clients per psychologist. Give
// the handler a generous budget so it can finish in one request.
export const maxDuration = 300;

/**
 * POST /api/v1/admin/encryption/backfill — Sprint 32 Phase 1.
 *
 * Walks every Client row that has a plaintext contactPhone but a null
 * contactPhoneEncrypted (or the equivalent for email) and dual-writes
 * the encrypted column. New rows already dual-write at the source
 * (POST /clients, PATCH /clients, DSR correction); this endpoint
 * exists only for the rollout transition window.
 *
 * Idempotent: rows that already have the encrypted column populated
 * are skipped. Safe to re-run.
 *
 * Audit: exactly one ENCRYPTION_BACKFILL_RAN row per invocation,
 * with counters in metadata. Per-row writes don't audit (high volume,
 * derivable from the summary).
 *
 * Admin-gated because it touches every tenant; therapists can't run
 * it for their own data via the regular UI, by design (the next
 * regular write encrypts their data anyway).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const dryRun = url.searchParams.get('dryRun') === 'true';
  const batchSize = Math.min(
    Math.max(parseInt(url.searchParams.get('batchSize') ?? '500', 10) || 500, 1),
    2000,
  );

  // Client PII (fullName / contactPhone / contactEmail) is now dropped as
  // plaintext — the columns are gone, so there is no source value left to
  // encrypt from. Every surviving row is either already backfilled or
  // unrecoverable; the Client PII backfill loop is retired. These counters
  // stay at 0 to preserve the audit + response shape.
  const phoneScanned = 0;
  const phoneEncrypted = 0;
  const emailScanned = 0;
  const emailEncrypted = 0;
  const fullNameScanned = 0;
  const fullNameEncrypted = 0;
  const errors: { clientId: string; field: string; message: string }[] = [];

  // No cursor — each pass shrinks the un-backfilled set (we only ever
  // turn nulls into non-nulls), so re-querying the same WHERE on each
  // loop iteration always returns fewer rows until the set is empty.
  // Dry-run is the only branch that doesn't make progress, so we cap
  // iterations defensively.
  const maxIterations = dryRun ? 1 : 10_000;

  // Sprint 54 — second pass: NoteDraft transcripts. Separate table +
  // loop because NoteDraft reaches its tenant via session.psychologistId
  // rather than carrying it directly. Same shrink-the-null-set
  // termination as the Client loop.
  let transcriptScanned = 0;
  let transcriptEncryptedCount = 0;
  let tIter = 0;
  while (tIter++ < maxIterations) {
    const drafts = await prisma.noteDraft.findMany({
      where: { transcript: { not: null }, transcriptEncrypted: null },
      orderBy: { id: 'asc' },
      take: batchSize,
      select: {
        id: true,
        transcript: true,
        session: { select: { psychologistId: true } },
      },
    });
    if (drafts.length === 0) break;
    for (const d of drafts) {
      if (!d.transcript) continue;
      transcriptScanned++;
      if (dryRun) {
        transcriptEncryptedCount++;
        continue;
      }
      try {
        const ct = await encryptForTenant(d.session.psychologistId, d.transcript);
        await prisma.noteDraft.update({
          where: { id: d.id },
          data: { transcriptEncrypted: ct },
        });
        transcriptEncryptedCount++;
      } catch (e) {
        errors.push({ clientId: d.id, field: 'transcript', message: (e as Error).message });
      }
    }
    if (dryRun) break;
  }

  // ---------------------------------------------------------------------
  // S-hardening (2026-08) — phase 3: VERIFIED plaintext scrub.
  //
  // For every draft still holding a plaintext transcript, confirm its
  // ciphertext actually DECRYPTS under the live KMS key before nulling the
  // plaintext. The verification is the whole point: early ciphertext may
  // have been minted under the local-dev key (the client-pii lesson) and a
  // blind SQL scrub would have destroyed the only readable copy of a
  // clinical transcript. Rows that fail verification are left untouched and
  // counted, so the operator can see exactly what remains. Cursor-paginated
  // (not shrink-the-set) because unverifiable rows stay in the set.
  //
  // The retention purge marker is skipped — it's a non-sensitive tombstone.
  // ---------------------------------------------------------------------
  const PURGED_MARKER = '(transcript purged per data-retention policy)';
  let scrubScanned = 0;
  let transcriptScrubbed = 0;
  let transcriptUnverifiable = 0;
  let cursor: string | null = null;
  let sIter = 0;
  while (sIter++ < maxIterations) {
    const drafts: Array<{
      id: string;
      transcript: string | null;
      transcriptEncrypted: string | null;
      session: { psychologistId: string };
    }> = await prisma.noteDraft.findMany({
      where: {
        transcript: { not: null },
        NOT: { transcript: PURGED_MARKER },
      },
      orderBy: { id: 'asc' },
      take: batchSize,
      ...(cursor !== null && { cursor: { id: cursor }, skip: 1 }),
      select: {
        id: true,
        transcript: true,
        transcriptEncrypted: true,
        session: { select: { psychologistId: true } },
      },
    });
    if (drafts.length === 0) break;
    cursor = drafts[drafts.length - 1]!.id;
    for (const d of drafts) {
      if (!d.transcript) continue;
      scrubScanned++;
      if (dryRun) continue;
      try {
        // Ensure ciphertext exists (phase 2 normally has), then round-trip it.
        let ct = d.transcriptEncrypted;
        if (!ct) {
          ct = await encryptForTenant(d.session.psychologistId, d.transcript);
          await prisma.noteDraft.update({
            where: { id: d.id },
            data: { transcriptEncrypted: ct },
          });
        }
        const roundTrip = await decryptForTenant(d.session.psychologistId, ct);
        if (roundTrip !== d.transcript) {
          transcriptUnverifiable++;
          continue;
        }
        await prisma.noteDraft.update({ where: { id: d.id }, data: { transcript: null } });
        transcriptScrubbed++;
      } catch (e) {
        transcriptUnverifiable++;
        errors.push({ clientId: d.id, field: 'transcript-scrub', message: (e as Error).message });
      }
    }
  }
  // What still holds plaintext after this run — the number that must hit 0
  // before the column-drop migration ships.
  const plaintextRemaining = await prisma.noteDraft.count({
    where: { transcript: { not: null }, NOT: { transcript: PURGED_MARKER } },
  });

  await writeAudit({
    actorType: 'PSYCHOLOGIST',
    actorPsychologistId: auth.value.psychologistId,
    action: 'ENCRYPTION_BACKFILL_RAN',
    targetType: 'Client',
    targetId: 'ALL',
    metadata: {
      ...auditMetadataFromRequest(req),
      dryRun,
      batchSize,
      phoneScanned,
      phoneEncrypted,
      emailScanned,
      emailEncrypted,
      fullNameScanned,
      fullNameEncrypted,
      transcriptScanned,
      transcriptEncrypted: transcriptEncryptedCount,
      scrubScanned,
      transcriptScrubbed,
      transcriptUnverifiable,
      plaintextRemaining,
      errorCount: errors.length,
    },
  });

  return NextResponse.json({
    dryRun,
    phoneScanned,
    phoneEncrypted,
    emailScanned,
    emailEncrypted,
    fullNameScanned,
    fullNameEncrypted,
    transcriptScanned,
    transcriptEncrypted: transcriptEncryptedCount,
    scrubScanned,
    transcriptScrubbed,
    transcriptUnverifiable,
    plaintextRemaining,
    errors,
  });
}
