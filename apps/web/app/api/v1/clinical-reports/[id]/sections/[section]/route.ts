import { NextResponse, type NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  ClinicalAssessmentGapSchema,
  ClinicalCrisisFlagSchema,
  ClinicalDiagnosisCandidateSchema,
  ClinicalRecommendedTherapySchema,
  ClinicalReportV1Schema,
  ClinicalSectionConfirmationsSchema,
  ClinicalSectionKeySchema,
  ClinicalTreatmentPlanSchema,
  ConfirmClinicalSectionInputSchema,
  PENDING_SECTION_CONFIRMATIONS,
  type ClinicalReportV1,
  type ClinicalSectionConfirmation,
  type ClinicalSectionConfirmations,
  type ClinicalSectionKey,
  type ClinicalTreatmentPlan,
} from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { toClinicalReport } from '@/lib/clinical-mappers';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/v1/clinical-reports/[id]/sections/[section]
 *
 * Confirms (accept / modify / reject) one section of a ClinicalReport.
 * The body schema is action-dependent:
 *   - accept: no body fields required
 *   - reject: { reason } required
 *   - modify: { reason, edits } required; edits validated against the
 *             per-section sub-schema below
 *
 * Side effects on action=accept|modify:
 *   - section=diagnosis → writes ClientDiagnosis row(s) (supersedes
 *     prior active primary if isPrimary flips).
 *   - section=plan → bumps TreatmentPlan.version + supersedes prior.
 *   - section=crisis with severity high/critical → also raises a
 *     CRISIS_ACKNOWLEDGED audit row.
 * Every confirmation writes a CLINICAL_SECTION_CONFIRMED audit row;
 * diagnosis/plan additionally write DIAGNOSIS_CONFIRMED / PLAN_CONFIRMED.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; section: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: reportId, section: sectionRaw } = await params;

  const sectionParse = ClinicalSectionKeySchema.safeParse(sectionRaw);
  if (!sectionParse.success) {
    return NextResponse.json(
      {
        error: `Unknown section "${sectionRaw}". Valid: diagnosis | gaps | formulation | plan | therapies | crisis`,
      },
      { status: 400 },
    );
  }
  const sectionKey: ClinicalSectionKey = sectionParse.data;

  const body = await parseJson(req, ConfirmClinicalSectionInputSchema);
  if (!body.ok) return body.response;

  // Per-section edits validation. accept doesn't require edits, but
  // when present we still validate so a misbehaving client can't
  // smuggle arbitrary JSON into the confirmations blob.
  let validatedEdits: unknown = body.value.edits ?? null;
  if (body.value.edits !== undefined && body.value.edits !== null) {
    const editsParse = parseSectionEdits(sectionKey, body.value.edits);
    if (!editsParse.ok) return editsParse.response;
    validatedEdits = editsParse.edits;
  }

  const report = await prisma.clinicalReport.findUnique({
    where: { id: reportId },
    select: {
      id: true,
      sessionId: true,
      clientId: true,
      psychologistId: true,
      body: true,
      confirmations: true,
      status: true,
    },
  });
  if (!report || report.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Clinical report not found' }, { status: 404 });
  }
  if (report.status !== 'COMPLETED' || !report.body) {
    return NextResponse.json(
      { error: `Report is ${report.status}; cannot confirm sections until Pass 3 completes.` },
      { status: 409 },
    );
  }
  const reportBody = ClinicalReportV1Schema.parse(report.body);

  const currentConfirmations = parseConfirmations(report.confirmations);
  const nextSectionEntry: ClinicalSectionConfirmation = {
    status:
      body.value.action === 'accept'
        ? 'ACCEPTED'
        : body.value.action === 'modify'
          ? 'MODIFIED'
          : 'REJECTED',
    confirmedAt: new Date().toISOString(),
    confirmedByPsychologistId: auth.value.psychologistId,
    reason: body.value.reason ?? null,
    edits: validatedEdits ?? null,
  };
  const nextConfirmations: ClinicalSectionConfirmations = {
    ...currentConfirmations,
    [sectionKey]: nextSectionEntry,
  };

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.clinicalReport.update({
      where: { id: report.id },
      data: {
        confirmations: nextConfirmations as unknown as Prisma.InputJsonValue,
      },
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
          section: sectionKey,
          action: body.value.action,
          reasonProvided: body.value.reason !== undefined,
        },
      },
      tx,
    );

    // Side effects for accept|modify on diagnosis / plan / crisis.
    if (body.value.action !== 'reject') {
      if (sectionKey === 'diagnosis') {
        const diagnosisBody = resolveDiagnosisBody(reportBody, validatedEdits);
        await applyDiagnosisConfirmation({
          tx,
          report,
          diagnosisBody,
          confirmedAt: now,
          psychologistId: auth.value.psychologistId,
          req,
        });
      } else if (sectionKey === 'plan') {
        const planBody = resolvePlanBody(reportBody, validatedEdits);
        await applyPlanConfirmation({
          tx,
          report,
          planBody,
          confirmedAt: now,
          psychologistId: auth.value.psychologistId,
          req,
        });
      } else if (sectionKey === 'crisis') {
        const highest = highestCrisisSeverity(reportBody);
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
              },
            },
            tx,
          );
        }
      }
    }
  });

  const refreshed = await prisma.clinicalReport.findUnique({ where: { id: reportId } });
  return NextResponse.json({
    report: refreshed ? toClinicalReport(refreshed) : null,
  });
}

// ============================================================================
// Per-section edit validation. The therapist's modified version of a
// section must conform to the same shape Pass 3 emits; we validate
// strictly so the UI never persists an unreadable section body.
// ============================================================================

type EditsResult =
  | { ok: true; edits: unknown }
  | { ok: false; response: NextResponse };

function parseSectionEdits(section: ClinicalSectionKey, edits: unknown): EditsResult {
  let schema: z.ZodTypeAny;
  switch (section) {
    case 'diagnosis':
      schema = z.object({
        diagnosisCandidates: z.array(ClinicalDiagnosisCandidateSchema).min(0).max(5),
        primaryDiagnosisIndex: z.number().int().nonnegative().nullable(),
      });
      break;
    case 'gaps':
      schema = z.object({
        assessmentGaps: z.array(ClinicalAssessmentGapSchema).max(8),
      });
      break;
    case 'formulation':
      schema = z.object({ formulation: z.string().min(1).max(4000) });
      break;
    case 'plan':
      schema = z.object({ treatmentPlan: ClinicalTreatmentPlanSchema });
      break;
    case 'therapies':
      schema = z.object({
        recommendedTherapies: z.array(ClinicalRecommendedTherapySchema).max(8),
      });
      break;
    case 'crisis':
      schema = z.object({
        crisisFlags: z.array(ClinicalCrisisFlagSchema).max(5),
      });
      break;
  }
  const parsed = schema!.safeParse(edits);
  if (!parsed.success) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: `Edits failed validation for section "${section}"`,
          issues: parsed.error.flatten(),
        },
        { status: 400 },
      ),
    };
  }
  return { ok: true, edits: parsed.data };
}

function parseConfirmations(raw: unknown): ClinicalSectionConfirmations {
  const parsed = ClinicalSectionConfirmationsSchema.safeParse(raw);
  return parsed.success ? parsed.data : PENDING_SECTION_CONFIRMATIONS;
}

function resolveDiagnosisBody(
  report: ClinicalReportV1,
  edits: unknown,
): { diagnosisCandidates: ClinicalReportV1['diagnosisCandidates']; primaryDiagnosisIndex: number | null } {
  if (edits && typeof edits === 'object' && 'diagnosisCandidates' in edits) {
    return edits as {
      diagnosisCandidates: ClinicalReportV1['diagnosisCandidates'];
      primaryDiagnosisIndex: number | null;
    };
  }
  return {
    diagnosisCandidates: report.diagnosisCandidates,
    primaryDiagnosisIndex: report.primaryDiagnosisIndex,
  };
}

function resolvePlanBody(report: ClinicalReportV1, edits: unknown): ClinicalTreatmentPlan {
  if (edits && typeof edits === 'object' && 'treatmentPlan' in edits) {
    return (edits as { treatmentPlan: ClinicalTreatmentPlan }).treatmentPlan;
  }
  return report.treatmentPlan;
}

function highestCrisisSeverity(report: ClinicalReportV1): 'none' | 'low' | 'medium' | 'high' | 'critical' {
  let max: 'none' | 'low' | 'medium' | 'high' | 'critical' = 'none';
  const rank = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };
  for (const flag of report.crisisFlags) {
    if (rank[flag.severity] > rank[max]) max = flag.severity;
  }
  return max;
}

// ============================================================================
// Side effects — apply diagnosis / plan to cumulative tables.
// ============================================================================

async function applyDiagnosisConfirmation(args: {
  tx: Prisma.TransactionClient;
  report: { id: string; sessionId: string; clientId: string };
  diagnosisBody: {
    diagnosisCandidates: ClinicalReportV1['diagnosisCandidates'];
    primaryDiagnosisIndex: number | null;
  };
  confirmedAt: Date;
  psychologistId: string;
  req: NextRequest;
}): Promise<void> {
  const { tx, report, diagnosisBody, confirmedAt, psychologistId, req } = args;
  if (diagnosisBody.diagnosisCandidates.length === 0) return;

  // Supersede prior active diagnoses for this client. This is the
  // simplest correctness model: each diagnosis-confirmation rebuilds
  // the client's active diagnosis set from the candidates in the
  // confirmed section. The therapist can re-edit + re-confirm to
  // refine.
  await tx.clientDiagnosis.updateMany({
    where: { clientId: report.clientId, supersededAt: null },
    data: { supersededAt: confirmedAt },
  });

  const primaryIdx = diagnosisBody.primaryDiagnosisIndex;
  for (let i = 0; i < diagnosisBody.diagnosisCandidates.length; i++) {
    const candidate = diagnosisBody.diagnosisCandidates[i]!;
    const created = await tx.clientDiagnosis.create({
      data: {
        clientId: report.clientId,
        psychologistId,
        sessionId: report.sessionId,
        clinicalReportId: report.id,
        icd11Code: candidate.icd11Code,
        icd11Label: candidate.icd11Label,
        confidence: candidate.confidence,
        supportingEvidence: candidate.supportingEvidence as unknown as Prisma.InputJsonValue,
        isPrimary: primaryIdx !== null && primaryIdx === i,
        confirmedAt,
        confirmedByPsychologistId: psychologistId,
      },
    });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: psychologistId,
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
        },
      },
      tx,
    );
  }
}

async function applyPlanConfirmation(args: {
  tx: Prisma.TransactionClient;
  report: { id: string; sessionId: string; clientId: string };
  planBody: ClinicalTreatmentPlan;
  confirmedAt: Date;
  psychologistId: string;
  req: NextRequest;
}): Promise<void> {
  const { tx, report, planBody, confirmedAt, psychologistId, req } = args;

  // Supersede the prior active plan, then create the new one at
  // version = max(prior) + 1. Per-client uniqueness on (clientId,
  // version) prevents two concurrent confirmations from colliding;
  // the second one will hit a unique-violation and retry.
  await tx.treatmentPlan.updateMany({
    where: { clientId: report.clientId, supersededAt: null },
    data: { supersededAt: confirmedAt },
  });
  const max = await tx.treatmentPlan.aggregate({
    where: { clientId: report.clientId },
    _max: { version: true },
  });
  const nextVersion = (max._max.version ?? 0) + 1;

  const created = await tx.treatmentPlan.create({
    data: {
      clientId: report.clientId,
      psychologistId,
      sourceSessionId: report.sessionId,
      sourceClinicalReportId: report.id,
      version: nextVersion,
      body: planBody as unknown as Prisma.InputJsonValue,
      confirmedAt,
      confirmedByPsychologistId: psychologistId,
    },
  });
  await writeAudit(
    {
      actorType: 'PSYCHOLOGIST',
      actorPsychologistId: psychologistId,
      action: 'PLAN_CONFIRMED',
      targetType: 'TreatmentPlan',
      targetId: created.id,
      metadata: {
        ...auditMetadataFromRequest(req),
        clinicalReportId: report.id,
        sessionId: report.sessionId,
        clientId: report.clientId,
        version: nextVersion,
        modality: planBody.modality,
        phaseCount: planBody.phaseSequence.length,
        goalCount: planBody.goals.length,
        expectedDurationSessions: planBody.expectedDurationSessions,
      },
    },
    tx,
  );
}
