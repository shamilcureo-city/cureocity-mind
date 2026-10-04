import type { NextRequest } from 'next/server';
import { requirePsychologistId } from '@/lib/auth-server';
import { enforceSameOriginMutation } from '@/lib/same-origin-mutation';
import { ReceptionSettingsSchema } from '@/lib/reception';
import { loadReceptionWorkspace, saveReceptionSettings } from '@/lib/reception-store';
import {
  readReceptionInput,
  receptionFailure,
  receptionJson,
  requireReceptionPilot,
} from '@/lib/reception-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    requireReceptionPilot();
    const auth = await requirePsychologistId(req);
    if (!auth.ok) return auth.response;
    return receptionJson(await loadReceptionWorkspace(auth.value.psychologistId));
  } catch (error) {
    return receptionFailure(error);
  }
}

export async function PUT(req: NextRequest) {
  try {
    requireReceptionPilot();
    const origin = enforceSameOriginMutation(req);
    if (origin) return origin;
    const auth = await requirePsychologistId(req);
    if (!auth.ok) return auth.response;
    const input = await readReceptionInput(req, ReceptionSettingsSchema);
    return receptionJson(await saveReceptionSettings(auth.value.psychologistId, input));
  } catch (error) {
    return receptionFailure(error);
  }
}
