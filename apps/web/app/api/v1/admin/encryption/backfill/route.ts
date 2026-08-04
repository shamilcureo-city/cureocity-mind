import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/admin/encryption/backfill — RETIRED, kept as an audited no-op.
 *
 * This route carried the whole plaintext-to-envelope-encryption rollout and
 * has nothing left to do:
 *
 * - Client PII (fullName / contactPhone / contactEmail): backfilled, read
 *   path cut over, plaintext columns DROPPED (S32 Phase 2, 2026-07).
 * - NoteDraft transcripts: backfilled, then this route's VERIFIED scrub —
 *   re-key stale local-dev ciphertext from plaintext, round-trip every row
 *   through the live KMS, null the plaintext only on an exact match —
 *   reported plaintextRemaining = 0 on production, and the plaintext column
 *   was DROPPED (S-hardening, 2026-08). New writes encrypt at source and
 *   FAIL CLOSED when KMS is down.
 *
 * The endpoint stays because operators know it and runbooks reference it:
 * calling it now writes the usual ENCRYPTION_BACKFILL_RAN audit row and
 * reports that there is no plaintext left anywhere to encrypt.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  await writeAudit({
    actorType: 'PSYCHOLOGIST',
    actorPsychologistId: auth.value.psychologistId,
    action: 'ENCRYPTION_BACKFILL_RAN',
    targetType: 'Client',
    targetId: 'ALL',
    metadata: {
      ...auditMetadataFromRequest(req),
      retired: true,
      note: 'All plaintext source columns dropped; nothing to backfill.',
    },
  });

  return NextResponse.json({
    retired: true,
    plaintextRemaining: 0,
    note: 'All plaintext source columns are dropped — every copy at rest is envelope-encrypted. Nothing to backfill.',
  });
}
