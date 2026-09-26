import { NextResponse, type NextRequest } from 'next/server';
import { requireScribeDoctor, scribeErrorResponse } from '@/lib/scribe-workspace-auth';
import { createScribeRecord } from '@/lib/scribe-workspace-store';
import { CreateScribeTaskSchema, ScribeTaskBodySchema } from '@/lib/scribe-preparation-contracts';
import { loadScribePendingWork } from '@/lib/scribe-preparation';
import { parseJson } from '@/lib/validate';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  const auth = await requireScribeDoctor(req);
  if (!auth.ok) return auth.response;
  try {
    const clientId = req.nextUrl.searchParams.get('clientId') || undefined;
    if (clientId) {
      const client = await prisma.client.findFirst({
        where: { id: clientId, psychologistId: auth.value.psychologistId, deletedAt: null },
        select: { id: true },
      });
      if (!client) return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
    }
    return NextResponse.json(await loadScribePendingWork(auth.value.psychologistId, clientId), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return scribeErrorResponse(error);
  }
}
export async function POST(req: NextRequest) {
  const auth = await requireScribeDoctor(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseJson(req, CreateScribeTaskSchema);
  if (!parsed.ok) return parsed.response;
  try {
    const { clientId, sessionId, task } = parsed.value;
    const record = await createScribeRecord(
      { psychologistId: auth.value.psychologistId, kind: 'task', clientId, sessionId },
      ScribeTaskBodySchema.parse(task),
    );
    return NextResponse.json(record, {
      status: 201,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return scribeErrorResponse(error);
  }
}
