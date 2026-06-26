import { NextResponse, type NextRequest } from 'next/server';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/psychologists/me/welcome — durably record that the therapist
 * has seen (and dismissed) the first-run welcome.
 *
 * Replaces the per-device localStorage flag: once set, the welcome stays
 * dismissed across every device/browser. POST-only (it has a side effect, so
 * it must never be reachable by a prefetched GET — see docs/AUTH_SESSION.md).
 * Idempotent: a second call is a no-op write.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;

  await prisma.psychologist.update({
    where: { id: auth.value.psychologistId },
    data: { hasSeenWelcome: true },
  });

  await writeAudit({
    actorType: 'PSYCHOLOGIST',
    actorPsychologistId: auth.value.psychologistId,
    action: 'WELCOME_DISMISSED',
    targetType: 'Psychologist',
    targetId: auth.value.psychologistId,
    metadata: auditMetadataFromRequest(req),
  });

  return NextResponse.json({ ok: true });
}
