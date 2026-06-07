import { NextResponse, type NextRequest } from 'next/server';
import type { AssessmentItem } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/clients/[id]/assessment-items
 *
 * Sprint 22 — the running differential. Returns the client's assessment
 * items newest-open-first so the workspace can render the "what to ask
 * next" checklist.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: clientId } = await params;

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { psychologistId: true, deletedAt: true },
  });
  if (!client || client.deletedAt !== null || client.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  const rows = await prisma.assessmentItem.findMany({
    where: { clientId },
    // OPEN first (status enum order puts OPEN before ADDRESSED before CLOSED),
    // then most recent.
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    take: 200,
  });

  const items: AssessmentItem[] = rows.map(toAssessmentItem);
  return NextResponse.json({ items });
}

export function toAssessmentItem(row: {
  id: string;
  clientId: string;
  psychologistId: string;
  episodeId: string | null;
  kind: AssessmentItem['kind'];
  question: string;
  rationale: string;
  icd11Code: string | null;
  status: AssessmentItem['status'];
  sourceSessionId: string | null;
  addressedSessionId: string | null;
  resolutionNote: string | null;
  createdAt: Date;
  updatedAt: Date;
  closedAt: Date | null;
}): AssessmentItem {
  return {
    id: row.id,
    clientId: row.clientId,
    psychologistId: row.psychologistId,
    episodeId: row.episodeId,
    kind: row.kind,
    question: row.question,
    rationale: row.rationale,
    icd11Code: row.icd11Code,
    status: row.status,
    sourceSessionId: row.sourceSessionId,
    addressedSessionId: row.addressedSessionId,
    resolutionNote: row.resolutionNote,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null,
  };
}
