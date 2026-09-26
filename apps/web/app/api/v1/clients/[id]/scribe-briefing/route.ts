import { NextResponse, type NextRequest } from 'next/server';
import { requireScribeDoctor, scribeErrorResponse } from '@/lib/scribe-workspace-auth';
import { loadScribeBriefing } from '@/lib/scribe-preparation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireScribeDoctor(req);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    const briefing = await loadScribeBriefing(auth.value.psychologistId, id);
    if (!briefing) return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
    return NextResponse.json(briefing, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return scribeErrorResponse(error);
  }
}
