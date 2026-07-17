import { NextResponse, type NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import {
  ClinicalSectionConfirmationsSchema,
  InitialAssessmentBriefV1Schema,
  PENDING_SECTION_CONFIRMATIONS,
  type ClinicalSectionConfirmations,
} from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/clinical-reports/[id]/intake-crisis
 *
 * The intake-shaped safety acknowledgement. An INTAKE report stores an
 * InitialAssessmentBriefV1 (not a ClinicalReportV1), so the shared sections
 * route — which parses the body as a ClinicalReportV1 — cannot confirm the
 * crisis section for an intake. This route is the intake equivalent: it marks
 * `confirmations.crisis = ACCEPTED` (lifting the board's safety gate) and
 * writes the same audit trail the sections route does — CLINICAL_SECTION_CONFIRMED
 * plus, on a high/critical flag, CRISIS_ACKNOWLEDGED. Tenant-checked, POST-only.
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
    select: {
      id: true,
      sessionId: true,
      clientId: true,
      psychologistId: true,
      status: true,
      body: true,
      confirmations: true,
      session: { select: { kind: true } },
    },
  });
  if (!report || report.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Report not found' }, { status: 404 });
  }
  if (report.session.kind !== 'INTAKE') {
    return NextResponse.json(
      { error: 'Not an intake report — acknowledge safety through the sections route.' },
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
  const highest = highestSeverity(parsedBrief.data.crisisFlags);

  const current = parseConfirmations(report.confirmations);
  const nextConfirmations: ClinicalSectionConfirmations = {
    ...current,
    crisis: {
      status: 'ACCEPTED',
      confirmedAt: new Date().toISOString(),
      confirmedByPsychologistId: auth.value.psychologistId,
      reason: null,
      edits: null,
    },
  };

  await prisma.$transaction(async (tx) => {
    await tx.clinicalReport.update({
      where: { id: report.id },
      data: { confirmations: nextConfirmations as unknown as Prisma.InputJsonValue },
    });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'CLINICAL_SECTION_CONFIRMED',
        targetType: 'ClinicalReport',
        targetId: report.id,
        metadata: {
          ...auditMetadataFromRequest(req),
          sessionId: report.sessionId,
          clientId: report.clientId,
          section: 'crisis',
          action: 'accept',
          source: 'INTAKE_BOARD',
        },
      },
      tx,
    );
    if (highest === 'high' || highest === 'critical') {
      await writeAudit(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: auth.value.psychologistId,
          action: 'CRISIS_ACKNOWLEDGED',
          targetType: 'ClinicalReport',
          targetId: report.id,
          metadata: {
            ...auditMetadataFromRequest(req),
            sessionId: report.sessionId,
            clientId: report.clientId,
            severity: highest,
            source: 'INTAKE_BOARD',
          },
        },
        tx,
      );
    }
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}

function parseConfirmations(raw: unknown): ClinicalSectionConfirmations {
  const parsed = ClinicalSectionConfirmationsSchema.safeParse(raw);
  return parsed.success ? parsed.data : PENDING_SECTION_CONFIRMATIONS;
}

function highestSeverity(
  flags: { severity: 'none' | 'low' | 'medium' | 'high' | 'critical' }[],
): 'none' | 'low' | 'medium' | 'high' | 'critical' {
  const rank = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };
  let max: 'none' | 'low' | 'medium' | 'high' | 'critical' = 'none';
  for (const f of flags) if (rank[f.severity] > rank[max]) max = f.severity;
  return max;
}
