import type { NextRequest } from 'next/server';
import {
  getPublicScribeTeleconsult,
  publicScribeTeleconsultToken,
  setPublicScribeTeleconsultConsent,
} from '@/lib/scribe-teleconsult';
import { assertScribeTeleconsultEnabled } from '@/lib/scribe-teleconsult-links';
import { ScribeTeleconsultPublicInputSchema } from '@/lib/scribe-teleconsult-contracts';
import { ScribeWorkspaceError } from '@/lib/scribe-workspace-auth';
import {
  readTeleconsultInput,
  teleconsultError,
  teleconsultJson,
} from '@/lib/scribe-teleconsult-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
export async function GET(req: NextRequest, ctx: Context) {
  try {
    assertScribeTeleconsultEnabled();
    const authorization = req.headers.get('authorization') ?? '';
    if (!authorization.startsWith('Bearer '))
      throw new ScribeWorkspaceError(404, 'This teleconsult link is unavailable.');
    const { id } = await ctx.params;
    return teleconsultJson(await getPublicScribeTeleconsult(id, authorization.slice(7)));
  } catch (error) {
    return teleconsultError(error);
  }
}
export async function POST(req: NextRequest, ctx: Context) {
  try {
    assertScribeTeleconsultEnabled();
    const input = await readTeleconsultInput(req, ScribeTeleconsultPublicInputSchema);
    const { id } = await ctx.params;
    return teleconsultJson(
      input.action === 'token'
        ? await publicScribeTeleconsultToken(id, input.token)
        : await setPublicScribeTeleconsultConsent(
            id,
            input.token,
            input.consent,
            input.expectedRevision,
          ),
    );
  } catch (error) {
    return teleconsultError(error);
  }
}
