import { NextResponse, type NextRequest } from 'next/server';
import {
  assertUidAvailableForPractitioner,
  requirePsychologistId,
  resolveFirebaseUidOnly,
} from './auth-server';
import { productFromHost } from './product';
import { prisma } from './prisma';

/** Profile submission only. Never use this guard for clinical or billing routes. */
export async function requireOnboardingIdentity(req: NextRequest) {
  if (productFromHost(new URL(req.url).hostname).key !== 'scribe')
    return requirePsychologistId(req);
  const identity = await resolveFirebaseUidOnly(req);
  if (!identity.ok) return identity;
  const exclusive = await assertUidAvailableForPractitioner(identity.value);
  if (!exclusive.ok) return exclusive;
  const row = await prisma.psychologist.findUnique({ where: { firebaseUid: identity.value } });
  if (!row || row.deletedAt || !['ACTIVE', 'PENDING_VERIFICATION'].includes(row.status)) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: 'Account cannot submit registration details' },
        { status: 403 },
      ),
    };
  }
  return {
    ok: true as const,
    value: {
      psychologistId: row.id,
      user: { firebaseUid: identity.value, vertical: row.vertical },
      pendingApproval: row.status === 'PENDING_VERIFICATION',
    },
  };
}
