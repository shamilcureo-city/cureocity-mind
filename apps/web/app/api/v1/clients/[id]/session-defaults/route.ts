import { NextResponse, type NextRequest } from 'next/server';
import { requireCapability, requirePsychologistId } from '@/lib/auth-server';
import { SessionDefaultsError, computeSessionDefaults } from '@/lib/session-defaults';
import { loadPreparedMindGuides } from '@/lib/load-prepared-mind-guides';

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

  // Separate optional read: guide availability must not delay or block the
  // ordinary capture defaults. Never generate a guide during preparation.
  if (req.nextUrl.searchParams.get('guides') === '1') {
    if (auth.value.user.vertical !== 'THERAPIST') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const workflowAuth = await requireCapability(req, 'THERAPY_WORKFLOWS', auth);
    if (!workflowAuth.ok) return workflowAuth.response;
    try {
      const guides = await loadPreparedMindGuides({
        clientId,
        psychologistId: auth.value.psychologistId,
        vertical: auth.value.user.vertical,
        capabilities: new Set(['THERAPY_WORKFLOWS']),
      });
      return NextResponse.json(
        {
          guides: guides.map(({ id, body, updatedAt }) => ({
            id,
            name: body.therapyName,
            updatedAt,
          })),
        },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    } catch {
      return NextResponse.json(
        { error: 'Prepared guides could not be loaded. You can continue without one.' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }
  }

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
