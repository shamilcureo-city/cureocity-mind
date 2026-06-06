import { NextResponse, type NextRequest } from 'next/server';
import { requirePsychologistId } from '@/lib/auth-server';
import {
  SessionDefaultsError,
  computeSessionDefaults,
} from '@/lib/session-defaults';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/clients/[id]/session-defaults
 *
 * Sprint 19 — feeds the Pre-Flight panel. Returns the auto-computed
 * defaults (kind, modality + source, language, spokenLanguages,
 * consent state, baseline-screener cadence) so the panel can pre-fill
 * everything and only surface fields where the cascade is uncertain.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: clientId } = await params;

  try {
    const defaults = await computeSessionDefaults(clientId, auth.value.psychologistId);
    return NextResponse.json({ defaults });
  } catch (e) {
    if (e instanceof SessionDefaultsError) {
      return NextResponse.json({ error: e.message }, { status: 404 });
    }
    throw e;
  }
}
