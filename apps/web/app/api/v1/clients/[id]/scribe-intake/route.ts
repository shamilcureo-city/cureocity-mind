import { NextResponse, type NextRequest } from 'next/server';
import { requireScribeDoctor, scribeErrorResponse } from '@/lib/scribe-workspace-auth';
import { createScribeRecord, listScribeRecords } from '@/lib/scribe-workspace-store';
import { CreateScribeIntakeSchema, ScribeIntakeBodySchema } from '@/lib/scribe-intake-contracts';
import { intakeFreshnessGuard, newIntakeGrant, publicIntakeRecord } from '@/lib/scribe-intake';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireScribeDoctor(req);
  if (!auth.ok) return auth.response;
  try {
    const { id: clientId } = await params;
    const records = await listScribeRecords(
      { psychologistId: auth.value.psychologistId, kind: 'intake', clientId },
      ScribeIntakeBodySchema,
    );
    return NextResponse.json(
      { items: records.map(publicIntakeRecord) },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return scribeErrorResponse(error);
  }
}
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireScribeDoctor(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseJson(req, CreateScribeIntakeSchema);
  if (!parsed.ok) return parsed.response;
  try {
    const { id: clientId } = await params;
    const { token, body } = newIntakeGrant(parsed.value.expiresInHours ?? 24);
    const record = await createScribeRecord(
      {
        psychologistId: auth.value.psychologistId,
        kind: 'intake',
        clientId,
        sessionId: parsed.value.sessionId,
        requireUnsigned: true,
        guard: intakeFreshnessGuard(body.expiresAt, parsed.value.sessionId),
      },
      body,
    );
    const fragment = new URLSearchParams({
      owner: auth.value.psychologistId,
      record: record.id,
      token,
    });
    // A relative URL avoids Host-header poisoning. The browser chooses its current origin.
    return NextResponse.json(
      { record: publicIntakeRecord(record), linkPath: `/p/scribe-intake#${fragment.toString()}` },
      { status: 201, headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return scribeErrorResponse(error);
  }
}
