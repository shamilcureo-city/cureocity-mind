import { NextResponse, type NextRequest } from 'next/server';
import { requirePsychologistId } from '@/lib/auth-server';
import { JourneyError, computeClientJourney } from '@/lib/journey';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/clients/[id]/journey
 *
 * Sprint 20 — measurement-based-care journey summary. Returns the
 * derived arc stage, working diagnosis, active-plan goals, per-instrument
 * reliable-change verdicts, and the single next-best-action. Everything
 * is composed from existing cumulative tables; no new storage.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: clientId } = await params;

  try {
    const journey = await computeClientJourney(clientId, auth.value.psychologistId);
    return NextResponse.json({ journey });
  } catch (e) {
    if (e instanceof JourneyError) {
      return NextResponse.json({ error: e.message }, { status: 404 });
    }
    throw e;
  }
}
