import { NextResponse, type NextRequest } from 'next/server';
import {
  AcceptIntakeDiagnosisInputSchema,
  InitialAssessmentBriefV1Schema,
} from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { parseJson } from '@/lib/validate';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sprint TSC — POST /api/v1/clinical-reports/[id]/intake-diagnosis
 *
 * The copilot decision board's intake-shaped diagnosis accept. Treatment
 * reports confirm diagnoses through the sections route; an INTAKE report
 * stores an InitialAssessmentBriefV1 (no section confirmations, no plan),
 * so this route lets the therapist accept SELECTED differential candidates
 * as the client's working diagnosis. Mirrors the sections route's write:
 * supersede the client's active diagnoses, create one ClientDiagnosis per
 * selected candidate, audit DIAGNOSIS_CONFIRMED per row. Tenant-checked,
 * POST-only.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: reportId } = await params;

  const body = await parseJson(req, AcceptIntakeDiagnosisInputSchema);
  if (!body.ok) return body.response;

  const report = await prisma.clinicalReport.findUnique({
    where: { id: reportId },
    select: {
      id: true,
      sessionId: true,
      clientId: true,
      psychologistId: true,
      status: true,
      body: true,
      session: { select: { kind: true } },
    },
  });
  if (!report || report.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Report not found' }, { status: 404 });
  }
  if (report.session.kind !== 'INTAKE') {
    return NextResponse.json(
      { error: 'Not an intake report — confirm diagnoses through the sections route.' },
      { status: 409 },
    );
  }
  if (report.status !== 'COMPLETED') {
    return NextResponse.json({ error: `Report is ${report.status}.` }, { status: 409 });
  }
  const parsedBrief = InitialAssessmentBriefV1Schema.safeParse(report.body);
  if (!parsedBrief.success) {
    return NextResponse.json(
      { error: 'Stored initial-assessment brief failed validation.' },
      { status: 422 },
    );
  }
  const brief = parsedBrief.data;

  // Resolve the selected candidates; reject out-of-range indexes.
  const selected = body.value.candidateIndexes.map((i) => brief.differential[i]);
  if (selected.some((c) => c === undefined)) {
    return NextResponse.json({ error: 'Candidate index out of range.' }, { status: 422 });
  }
  const primarySel = body.value.primarySelectionIndex;
  if (primarySel !== null && primarySel >= selected.length) {
    return NextResponse.json({ error: 'Primary selection out of range.' }, { status: 422 });
  }

  const confirmedAt = new Date();
  const createdIds: string[] = [];
  await prisma.$transaction(async (tx) => {
    // Same correctness model as the sections route: each confirmation
    // rebuilds the client's active diagnosis set from what was accepted.
    await tx.clientDiagnosis.updateMany({
      where: { clientId: report.clientId, supersededAt: null },
      data: { supersededAt: confirmedAt },
    });
    for (let i = 0; i < selected.length; i++) {
      const candidate = selected[i]!;
      const created = await tx.clientDiagnosis.create({
        data: {
          clientId: report.clientId,
          psychologistId: auth.value.psychologistId,
          sessionId: report.sessionId,
          clinicalReportId: report.id,
          icd11Code: candidate.icd11Code,
          icd11Label: candidate.icd11Label,
          confidence: candidate.confidence,
          supportingEvidence: candidate.supportingEvidence as unknown as Prisma.InputJsonValue,
          isPrimary: primarySel !== null && primarySel === i,
          confirmedAt,
          confirmedByPsychologistId: auth.value.psychologistId,
        },
      });
      createdIds.push(created.id);
      await writeAudit(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: auth.value.psychologistId,
          action: 'DIAGNOSIS_CONFIRMED',
          targetType: 'ClientDiagnosis',
          targetId: created.id,
          metadata: {
            ...auditMetadataFromRequest(req),
            clinicalReportId: report.id,
            sessionId: report.sessionId,
            clientId: report.clientId,
            icd11Code: candidate.icd11Code,
            isPrimary: created.isPrimary,
            confidence: candidate.confidence,
            source: 'INTAKE_BOARD',
          },
        },
        tx,
      );
    }
  });

  return NextResponse.json({ ok: true, created: createdIds.length }, { status: 200 });
}
