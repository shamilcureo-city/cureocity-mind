import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { encryptForTenant } from '@/lib/tenant-crypto';

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

  // Two passes — phone first, email second — share the same Client
  // table scan but exit early when nothing else is left to backfill.
  let phoneScanned = 0;
  let phoneEncrypted = 0;
  let emailScanned = 0;
  let emailEncrypted = 0;
  // Sprint 54 — fullName joins the backfill.
  let fullNameScanned = 0;
  let fullNameEncrypted = 0;
  const errors: { clientId: string; field: string; message: string }[] = [];

  // No cursor — each pass shrinks the un-backfilled set (we only ever
  // turn nulls into non-nulls), so re-querying the same WHERE on each
  // loop iteration always returns fewer rows until the set is empty.
  // Dry-run is the only branch that doesn't make progress, so we cap
  // iterations defensively.
  const maxIterations = dryRun ? 1 : 10_000;
  let iter = 0;
  while (iter++ < maxIterations) {
    const rows = await prisma.client.findMany({
      where: {
        OR: [
          { contactPhone: { not: '' }, contactPhoneEncrypted: null },
          { contactEmail: { not: null }, contactEmailEncrypted: null },
          // fullName is non-empty by schema, so a null encrypted column
          // is the only condition that marks a row as un-backfilled.
          { fullNameEncrypted: null },
        ],
      },
      orderBy: { id: 'asc' },
      take: batchSize,
      select: {
        id: true,
        psychologistId: true,
        fullName: true,
        contactPhone: true,
        contactEmail: true,
        fullNameEncrypted: true,
        contactPhoneEncrypted: true,
        contactEmailEncrypted: true,
      },
    });
    if (rows.length === 0) break;

    for (const row of rows) {
      // Phone — every Client has a non-empty contactPhone by schema.
      if (row.contactPhoneEncrypted === null && row.contactPhone) {
        phoneScanned++;
        if (!dryRun) {
          try {
            const ct = await encryptForTenant(row.psychologistId, row.contactPhone);
            await prisma.client.update({
              where: { id: row.id },
              data: { contactPhoneEncrypted: ct },
            });
            phoneEncrypted++;
          } catch (e) {
            errors.push({ clientId: row.id, field: 'phone', message: (e as Error).message });
          }
        } else {
          phoneEncrypted++;
        }
      }
      // Email — nullable.
      if (row.contactEmailEncrypted === null && row.contactEmail) {
        emailScanned++;
        if (!dryRun) {
          try {
            const ct = await encryptForTenant(row.psychologistId, row.contactEmail);
            await prisma.client.update({
              where: { id: row.id },
              data: { contactEmailEncrypted: ct },
            });
            emailEncrypted++;
          } catch (e) {
            errors.push({ clientId: row.id, field: 'email', message: (e as Error).message });
          }
        } else {
          emailEncrypted++;
        }
      }
      // Sprint 54 — fullName, always present by schema.
      if (row.fullNameEncrypted === null && row.fullName) {
        fullNameScanned++;
        if (!dryRun) {
          try {
            const ct = await encryptForTenant(row.psychologistId, row.fullName);
            await prisma.client.update({
              where: { id: row.id },
              data: { fullNameEncrypted: ct },
            });
            fullNameEncrypted++;
          } catch (e) {
            errors.push({ clientId: row.id, field: 'fullName', message: (e as Error).message });
          }
        } else {
          fullNameEncrypted++;
        }
      }
    }
  }

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
    errors,
  });
}
