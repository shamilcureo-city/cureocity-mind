import type {
  ClientDiagnosis as ClientDiagnosisRow,
  ClinicalReport as ClinicalReportRow,
  TreatmentPlan as TreatmentPlanRow,
} from '@prisma/client';
import {
  ClinicalReportV1Schema,
  ClinicalSectionConfirmationsSchema,
  ClinicalSupportingQuoteSchema,
  ClinicalTreatmentPlanSchema,
  PENDING_SECTION_CONFIRMATIONS,
  type ClientDiagnosis,
  type ClinicalReport,
  type ClinicalReportV1,
  type ClinicalSectionConfirmations,
  type ClinicalSupportingQuote,
  type ClinicalTreatmentPlan,
  type TreatmentPlan,
} from '@cureocity/contracts';

/**
 * Sprint 13 — Prisma rows → API DTOs for the clinical co-pilot
 * surfaces. Sibling to lib/mappers.ts; kept in its own file because
 * the schemas are large and self-contained.
 *
 * Each mapper is defensive: invalid stored JSON (e.g. a legacy row
 * that pre-dates the latest schema) falls back to safe defaults
 * rather than throwing — the UI can still render and the therapist
 * can re-run Pass 3 to refresh.
 */

export function toClinicalReport(row: ClinicalReportRow): ClinicalReport {
  let body: ClinicalReportV1 | null = null;
  if (row.body !== null && row.body !== undefined) {
    const parsed = ClinicalReportV1Schema.safeParse(row.body);
    body = parsed.success ? parsed.data : null;
  }
  let confirmations: ClinicalSectionConfirmations;
  if (row.confirmations) {
    const parsed = ClinicalSectionConfirmationsSchema.safeParse(row.confirmations);
    confirmations = parsed.success ? parsed.data : PENDING_SECTION_CONFIRMATIONS;
  } else {
    confirmations = PENDING_SECTION_CONFIRMATIONS;
  }
  return {
    id: row.id,
    sessionId: row.sessionId,
    clientId: row.clientId,
    psychologistId: row.psychologistId,
    status: row.status,
    body,
    confirmations,
    totalCostInr: row.totalCostInr.toString(),
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toClientDiagnosis(row: ClientDiagnosisRow): ClientDiagnosis {
  const supportingEvidence = parseSupportingQuotes(row.supportingEvidence);
  return {
    id: row.id,
    clientId: row.clientId,
    psychologistId: row.psychologistId,
    sessionId: row.sessionId,
    clinicalReportId: row.clinicalReportId,
    icd11Code: row.icd11Code,
    icd11Label: row.icd11Label,
    confidence: row.confidence,
    supportingEvidence,
    isPrimary: row.isPrimary,
    confirmedAt: row.confirmedAt.toISOString(),
    confirmedByPsychologistId: row.confirmedByPsychologistId,
    supersededAt: row.supersededAt?.toISOString() ?? null,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toTreatmentPlan(row: TreatmentPlanRow): TreatmentPlan {
  const parsedBody = ClinicalTreatmentPlanSchema.safeParse(row.body);
  const body: ClinicalTreatmentPlan = parsedBody.success
    ? parsedBody.data
    : {
        modality: 'other',
        phaseSequence: [],
        goals: [],
        expectedDurationSessions: null,
      };
  return {
    id: row.id,
    clientId: row.clientId,
    psychologistId: row.psychologistId,
    sourceSessionId: row.sourceSessionId,
    sourceClinicalReportId: row.sourceClinicalReportId,
    version: row.version,
    body,
    confirmedAt: row.confirmedAt.toISOString(),
    confirmedByPsychologistId: row.confirmedByPsychologistId,
    supersededAt: row.supersededAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function parseSupportingQuotes(raw: unknown): ClinicalSupportingQuote[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((q) => ClinicalSupportingQuoteSchema.safeParse(q))
    .filter((r): r is { success: true; data: ClinicalSupportingQuote } => r.success)
    .map((r) => r.data);
}
