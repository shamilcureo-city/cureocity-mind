import type {
  ClientDiagnosis as ClientDiagnosisRow,
  ClinicalReport as ClinicalReportRow,
  InstrumentResponse as InstrumentResponseRow,
  PatientShare as PatientShareRow,
  PreSessionBrief as PreSessionBriefRow,
  SafetyPlan as SafetyPlanRow,
  TherapyScript as TherapyScriptRow,
  TreatmentPlan as TreatmentPlanRow,
} from '@prisma/client';
import {
  ClinicalLocaleSchema,
  ClinicalReportV1Schema,
  ClinicalSectionConfirmationsSchema,
  ClinicalSupportingQuoteSchema,
  ClinicalTreatmentPlanSchema,
  InitialAssessmentBriefV1Schema,
  InstrumentKeySchema,
  InstrumentResponseMapSchema,
  PatientShareSnapshotSchema,
  PENDING_SECTION_CONFIRMATIONS,
  PreSessionBriefV1Schema,
  SafetyPlanV1Schema,
  TherapyScriptV1Schema,
  type ClientDiagnosis,
  type ClinicalLocale,
  type ClinicalReport,
  type ClinicalReportV1,
  type ClinicalSectionConfirmations,
  type ClinicalSupportingQuote,
  type ClinicalTreatmentPlan,
  type InitialAssessmentBriefV1,
  type InstrumentResponse,
  type PatientShare,
  type PatientShareSnapshot,
  type PreSessionBrief,
  type PreSessionBriefV1,
  type SafetyPlanRow as SafetyPlanDto,
  type SafetyPlanV1,
  type TherapyScript,
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

/**
 * Sprint 19 — parse the InitialAssessmentBrief stored on a ClinicalReport
 * row for an INTAKE-kind session. The Prisma column accepts either
 * shape opaquely; the mapper picks the right parser based on
 * session.kind (passed by the page).
 */
export function readInitialAssessmentBrief(
  row: ClinicalReportRow,
): InitialAssessmentBriefV1 | null {
  if (row.body === null || row.body === undefined) return null;
  const parsed = InitialAssessmentBriefV1Schema.safeParse(row.body);
  return parsed.success ? parsed.data : null;
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

export function toPatientShare(row: PatientShareRow): PatientShare {
  const snapshotParse = PatientShareSnapshotSchema.safeParse(row.snapshot);
  const snapshot: PatientShareSnapshot = snapshotParse.success
    ? snapshotParse.data
    : {
        kind: 'REFLECTION_QUESTIONS',
        questions: ['(snapshot failed validation — open the source artefact)'],
      };
  const langParse = ClinicalLocaleSchema.safeParse(row.language);
  const language: ClinicalLocale = langParse.success ? langParse.data : 'en';
  return {
    id: row.id,
    clientId: row.clientId,
    psychologistId: row.psychologistId,
    sessionId: row.sessionId,
    artefactType: row.artefactType,
    artefactId: row.artefactId,
    channel: row.channel,
    status: row.status,
    shareToken: row.shareToken,
    language,
    snapshot,
    subject: row.subject,
    toContact: row.toContact,
    providerMessageId: row.providerMessageId,
    errorCode: row.errorCode,
    errorDetail: row.errorDetail,
    sentAt: row.sentAt?.toISOString() ?? null,
    openedAt: row.openedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toTherapyScript(row: TherapyScriptRow): TherapyScript {
  const parsedBody = TherapyScriptV1Schema.safeParse(row.body);
  const body = parsedBody.success
    ? parsedBody.data
    : {
        version: 'V1' as const,
        language: 'en' as const,
        therapyName: row.therapyName,
        openingScript: '(legacy script row failed schema validation)',
        mainExercise: { steps: [] as never[] },
        adaptationCues: [],
        closingScript: '',
        homework: { description: '', deliveryNotes: '' },
        riskWatchpoints: [],
        estimatedDurationMin: 45,
      };
  const parsedLang = ClinicalLocaleSchema.safeParse(row.language);
  const language: ClinicalLocale = parsedLang.success ? parsedLang.data : 'en';
  return {
    id: row.id,
    clientId: row.clientId,
    psychologistId: row.psychologistId,
    therapyName: row.therapyName,
    language,
    cacheKey: row.cacheKey,
    body: body as TherapyScript['body'],
    sourceTreatmentPlanId: row.sourceTreatmentPlanId,
    sourcePrimaryDiagnosisId: row.sourcePrimaryDiagnosisId,
    totalCostInr: row.totalCostInr.toString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toPreSessionBrief(row: PreSessionBriefRow): PreSessionBrief {
  let body: PreSessionBriefV1 | null = null;
  if (row.body !== null && row.body !== undefined) {
    const parsed = PreSessionBriefV1Schema.safeParse(row.body);
    body = parsed.success ? parsed.data : null;
  }
  const langParse = ClinicalLocaleSchema.safeParse(row.language);
  const language: ClinicalLocale = langParse.success ? langParse.data : 'en';
  return {
    id: row.id,
    clientId: row.clientId,
    psychologistId: row.psychologistId,
    lastSessionId: row.lastSessionId,
    language,
    status: row.status,
    body,
    totalCostInr: row.totalCostInr.toString(),
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toInstrumentResponse(row: InstrumentResponseRow): InstrumentResponse {
  const keyParse = InstrumentKeySchema.safeParse(row.instrumentKey);
  const langParse = ClinicalLocaleSchema.safeParse(row.language);
  const responsesParse = InstrumentResponseMapSchema.safeParse(row.responses);
  return {
    id: row.id,
    clientId: row.clientId,
    psychologistId: row.psychologistId,
    sessionId: row.sessionId,
    instrumentKey: keyParse.success ? keyParse.data : 'PHQ9',
    language: langParse.success ? langParse.data : 'en',
    responses: responsesParse.success ? responsesParse.data : {},
    score: row.score,
    severity: row.severity,
    administeredAt: row.administeredAt.toISOString(),
    administeredByPsychologistId: row.administeredByPsychologistId,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toSafetyPlanRow(row: SafetyPlanRow): SafetyPlanDto {
  const langParse = ClinicalLocaleSchema.safeParse(row.language);
  const bodyParse = SafetyPlanV1Schema.safeParse(row.body);
  const body: SafetyPlanV1 = bodyParse.success
    ? bodyParse.data
    : {
        version: 'V1',
        language: 'en',
        warningSigns: ['(legacy plan failed schema validation)'],
        internalCoping: ['(legacy plan failed schema validation)'],
        socialDistractions: [{ name: 'placeholder' }],
        helpContacts: [{ name: 'placeholder', contact: 'unknown' }],
        professionals: [{ name: 'placeholder', contact: 'unknown' }],
      };
  return {
    id: row.id,
    clientId: row.clientId,
    psychologistId: row.psychologistId,
    sourceSessionId: row.sourceSessionId,
    language: langParse.success ? langParse.data : 'en',
    body,
    confirmedAt: row.confirmedAt.toISOString(),
    confirmedByPsychologistId: row.confirmedByPsychologistId,
    supersededAt: row.supersededAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
