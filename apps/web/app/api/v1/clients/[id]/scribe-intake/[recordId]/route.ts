import { NextResponse, type NextRequest } from 'next/server';
import { requireScribeDoctor, scribeErrorResponse } from '@/lib/scribe-workspace-auth';
import { getScribeRecord, updateScribeRecord } from '@/lib/scribe-workspace-store';
import { ReviewScribeIntakeSchema, ScribeIntakeBodySchema } from '@/lib/scribe-intake-contracts';
import { publicIntakeRecord } from '@/lib/scribe-intake';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; recordId: string }> },
) {
  const auth = await requireScribeDoctor(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseJson(req, ReviewScribeIntakeSchema);
  if (!parsed.ok) return parsed.response;
  try {
    const { id: clientId, recordId } = await params;
    const scope = { psychologistId: auth.value.psychologistId, kind: 'intake' as const, clientId };
    const record = await getScribeRecord(scope, recordId, ScribeIntakeBodySchema);
    if (!record) return NextResponse.json({ error: 'Submission not found' }, { status: 404 });
    const { action, note, expectedRevision } = parsed.value;
    if (action !== 'revoke' && (!record.body.report || record.body.review.status !== 'pending'))
      return NextResponse.json(
        { error: 'Only a pending submission can be reviewed' },
        { status: 409 },
      );
    const now = new Date().toISOString();
    const body =
      action === 'revoke'
        ? { ...record.body, revokedAt: now }
        : {
            ...record.body,
            review: {
              status: action,
              reviewedBy: auth.value.psychologistId,
              reviewedAt: now,
              note: note ?? '',
            },
          };
    const updated = await updateScribeRecord(
      { ...scope, ...(record.sessionId ? { sessionId: record.sessionId } : {}) },
      recordId,
      expectedRevision,
      body,
    );
    return NextResponse.json(publicIntakeRecord(updated), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return scribeErrorResponse(error);
  }
}
