import { NextResponse, type NextRequest } from 'next/server';
import { requireScribeDoctor, scribeErrorResponse } from '@/lib/scribe-workspace-auth';
import { getScribeRecord, updateScribeRecord } from '@/lib/scribe-workspace-store';
import { ScribeTaskBodySchema, UpdateScribeTaskSchema } from '@/lib/scribe-preparation-contracts';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> },
) {
  const auth = await requireScribeDoctor(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseJson(req, UpdateScribeTaskSchema);
  if (!parsed.ok) return parsed.response;
  try {
    const { recordId } = await params;
    const scope = { psychologistId: auth.value.psychologistId, kind: 'task' as const };
    const current = await getScribeRecord(scope, recordId, ScribeTaskBodySchema);
    if (!current) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    const record = await updateScribeRecord(
      {
        ...scope,
        ...(current.clientId ? { clientId: current.clientId } : {}),
        ...(current.sessionId ? { sessionId: current.sessionId } : {}),
      },
      recordId,
      parsed.value.expectedRevision,
      parsed.value.task,
    );
    return NextResponse.json(record, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return scribeErrorResponse(error);
  }
}
