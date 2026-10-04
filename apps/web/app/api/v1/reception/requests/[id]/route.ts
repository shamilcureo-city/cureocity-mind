import type { NextRequest } from 'next/server';
import { requireCapability, requirePsychologistId } from '@/lib/auth-server';
import { enforceSameOriginMutation } from '@/lib/same-origin-mutation';
import { ReceptionActionSchema } from '@/lib/reception';
import { actOnReceptionRequest } from '@/lib/reception-store';
import {
  readReceptionInput,
  receptionFailure,
  receptionJson,
  requireReceptionPilot,
} from '@/lib/reception-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireReceptionPilot();
    const origin = enforceSameOriginMutation(req);
    if (origin) return origin;
    const auth = await requirePsychologistId(req);
    if (!auth.ok) return auth.response;
    const input = await readReceptionInput(req, ReceptionActionSchema);
    if (input.action === 'APPROVE_BOOKING') {
      const capability = await requireCapability(
        req,
        auth.value.user.vertical === 'DOCTOR'
          ? 'MEDICAL_DOCUMENTATION'
          : 'BEHAVIORAL_HEALTH_DOCUMENTATION',
        auth,
      );
      if (!capability.ok) return capability.response;
    }
    const { id } = await params;
    return receptionJson(await actOnReceptionRequest(auth.value.psychologistId, id, input));
  } catch (error) {
    return receptionFailure(error);
  }
}
