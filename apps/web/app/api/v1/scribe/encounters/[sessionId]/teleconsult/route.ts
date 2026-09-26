import type { NextRequest } from 'next/server';
import { requireCapability } from '@/lib/auth-server';
import { requireScribeDoctor } from '@/lib/scribe-workspace-auth';
import { getScribeTeleconsultManagement, manageScribeTeleconsult } from '@/lib/scribe-teleconsult';
import { assertScribeTeleconsultEnabled } from '@/lib/scribe-teleconsult-links';
import { ScribeTeleconsultManagementInputSchema } from '@/lib/scribe-teleconsult-contracts';
import {
  readTeleconsultInput,
  teleconsultError,
  teleconsultJson,
} from '@/lib/scribe-teleconsult-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ sessionId: string }> };
async function authorize(req: NextRequest) {
  assertScribeTeleconsultEnabled();
  const doctor = await requireScribeDoctor(req, 'MEDICAL_DOCUMENTATION');
  return doctor.ok ? requireCapability(req, 'LIVE_ENCOUNTER', doctor) : doctor;
}
export async function GET(req: NextRequest, ctx: Context) {
  try {
    const auth = await authorize(req);
    if (!auth.ok) return auth.response;
    const { sessionId } = await ctx.params;
    return teleconsultJson(
      await getScribeTeleconsultManagement(auth.value.psychologistId, sessionId),
    );
  } catch (error) {
    return teleconsultError(error);
  }
}
export async function POST(req: NextRequest, ctx: Context) {
  try {
    const auth = await authorize(req);
    if (!auth.ok) return auth.response;
    const input = await readTeleconsultInput(req, ScribeTeleconsultManagementInputSchema);
    if (
      input.action === 'documentation' &&
      ['preparing', 'recording', 'draining'].includes(input.state)
    ) {
      const captureAuth = await requireCapability(req, 'AMBIENT_CAPTURE', auth);
      if (!captureAuth.ok) return captureAuth.response;
    }
    const { sessionId } = await ctx.params;
    return teleconsultJson(
      await manageScribeTeleconsult(
        auth.value.psychologistId,
        sessionId,
        input,
        req.nextUrl.origin,
      ),
    );
  } catch (error) {
    return teleconsultError(error);
  }
}
