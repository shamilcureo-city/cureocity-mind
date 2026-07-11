import { NextResponse, type NextRequest } from 'next/server';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sprint TSC-V2 — POST /api/v1/clinical-reports/[id]/finish-review
 *
 * The decision board's wrap-up "Finish review" button. Stamps
 * ClinicalReport.reviewedAt so the board (and any rollup) knows the
 * therapist has been through this session's copilot review. It is a
 * CHECKPOINT, not a lock — every decision stays revisable afterwards, and
 * re-tapping just refreshes the timestamp. Tenant-checked, POST-only (a
 * side effect must never be reachable by a prefetched GET).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: reportId } = await params;

  const report = await prisma.clinicalReport.findUnique({
    where: { id: reportId },
    select: { id: true, sessionId: true, clientId: true, psychologistId: true, status: true },
  });
  if (!report || report.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Report not found' }, { status: 404 });
  }
  if (report.status !== 'COMPLETED') {
    return NextResponse.json(
      { error: `Report is ${report.status}; nothing to finish yet.` },
      { status: 409 },
    );
  }

  const reviewedAt = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.clinicalReport.update({ where: { id: report.id }, data: { reviewedAt } });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'COPILOT_REVIEW_FINISHED',
        targetType: 'ClinicalReport',
        targetId: report.id,
        metadata: {
          ...auditMetadataFromRequest(req),
          sessionId: report.sessionId,
          clientId: report.clientId,
        },
      },
      tx,
    );
  });

  return NextResponse.json({ ok: true, reviewedAt: reviewedAt.toISOString() }, { status: 200 });
}
