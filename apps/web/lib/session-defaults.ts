import type { ConsentScope } from '@prisma/client';
import {
  type ClinicalLocale,
  ClinicalLocaleSchema,
  type ModalitySource,
  type SessionDefaults,
  type SessionKind,
  type SessionModality,
} from '@cureocity/contracts';
import { prisma } from './prisma';

export type { ModalitySource, SessionDefaults } from '@cureocity/contracts';

/**
 * Sprint 19 — session-defaults cascade.
 *
 * The Pre-Flight panel + the session-create route both call this to
 * compute a sensible default for every field that USED to be a manual
 * choice in the old 3-step PreRecordWizard. The therapist can edit any
 * of the values before submitting; the create route audits whether the
 * cascade was overridden.
 *
 * Cascade order for modality (highest → lowest priority):
 *   1. Active TreatmentPlan.body.modality
 *   2. Client.preferredModality
 *   3. Psychologist.defaultModality
 *   4. INTAKE sentinel (when no prior session AND no plan)
 *   5. SUPPORTIVE last-resort fallback
 *
 * kind detection:
 *   INTAKE     — no prior COMPLETED session for this client AND no
 *                confirmed (non-superseded) TreatmentPlan
 *   REVIEW     — active plan's `confirmedAt` is ≥8 completed sessions
 *                ago (rough re-eval cadence)
 *   TREATMENT  — everything else
 */

const INTAKE_FALLBACK: SessionModality = 'INTAKE';
const LAST_RESORT_FALLBACK: SessionModality = 'SUPPORTIVE';
/** Number of completed sessions after which an active plan triggers REVIEW. */
const REVIEW_THRESHOLD_SESSIONS = 8;

const REQUIRED_CONSENTS: ConsentScope[] = [
  'AUDIO_RECORDING',
  'AI_NOTE_GENERATION',
  'CROSS_BORDER_PROCESSING',
];

/**
 * Compute the cascade. Throws if client doesn't belong to the
 * requesting psychologist (route handlers should verify ownership
 * separately, but the helper is defensive).
 */
export async function computeSessionDefaults(
  clientId: string,
  psychologistId: string,
): Promise<SessionDefaults> {
  const [
    client,
    psychologist,
    activePlan,
    completedCount,
    grantedConsents,
    phq9Latest,
    gad7Latest,
    lastCompleted,
  ] = await Promise.all([
    prisma.client.findUnique({
      where: { id: clientId },
      select: {
        psychologistId: true,
        preferredModality: true,
        preferredLanguage: true,
        spokenLanguages: true,
        deletedAt: true,
      },
    }),
    prisma.psychologist.findUnique({
      where: { id: psychologistId },
      select: {
        defaultModality: true,
        defaultOutputLanguage: true,
      },
    }),
    prisma.treatmentPlan.findFirst({
      where: { clientId, supersededAt: null },
      orderBy: { version: 'desc' },
      select: { id: true, body: true, confirmedAt: true },
    }),
    prisma.session.count({
      where: { clientId, status: 'COMPLETED' },
    }),
    prisma.consent.findMany({
      where: { clientId, status: 'GRANTED' },
      select: { scope: true },
      distinct: ['scope'],
    }),
    prisma.instrumentResponse.findFirst({
      where: { clientId, instrumentKey: 'PHQ9' },
      orderBy: { administeredAt: 'desc' },
      select: { administeredAt: true },
    }),
    prisma.instrumentResponse.findFirst({
      where: { clientId, instrumentKey: 'GAD7' },
      orderBy: { administeredAt: 'desc' },
      select: { administeredAt: true },
    }),
    prisma.session.findFirst({
      where: { clientId, status: 'COMPLETED' },
      orderBy: { endedAt: 'desc' },
      select: { endedAt: true },
    }),
  ]);

  if (!client || client.deletedAt !== null) {
    throw new SessionDefaultsError('Client not found');
  }
  if (client.psychologistId !== psychologistId) {
    throw new SessionDefaultsError('Client not owned by this psychologist');
  }

  // Detect kind.
  const hasPlan = activePlan !== null;
  let kind: SessionKind;
  if (!hasPlan && completedCount === 0) {
    kind = 'INTAKE';
  } else if (hasPlan) {
    // REVIEW if the plan has aged past the threshold.
    const ageSessions =
      completedCount -
      (await prisma.session.count({
        where: {
          clientId,
          status: 'COMPLETED',
          endedAt: { lt: activePlan.confirmedAt },
        },
      }));
    kind = ageSessions >= REVIEW_THRESHOLD_SESSIONS ? 'REVIEW' : 'TREATMENT';
  } else {
    kind = 'TREATMENT';
  }

  // Cascade modality.
  let modality: SessionModality | null = null;
  let modalitySource: ModalitySource = 'intake-fallback';
  const planModality = readPlanModality(activePlan?.body);
  if (planModality) {
    modality = planModality;
    modalitySource = 'plan';
  } else if (client.preferredModality) {
    modality = client.preferredModality as SessionModality;
    modalitySource = 'client';
  } else if (psychologist?.defaultModality) {
    modality = psychologist.defaultModality as SessionModality;
    modalitySource = 'therapist';
  } else if (kind === 'INTAKE') {
    modality = INTAKE_FALLBACK;
    modalitySource = 'intake-fallback';
  } else {
    modality = LAST_RESORT_FALLBACK;
    modalitySource = 'last-resort';
  }

  // Language defaults.
  const language: ClinicalLocale = parseLocale(
    psychologist?.defaultOutputLanguage ?? client.preferredLanguage,
  );
  const spokenLanguages = client.spokenLanguages ?? [];

  // Consent state.
  const grantedSet = new Set<ConsentScope>(grantedConsents.map((c) => c.scope));
  const consentsAlreadyGranted = REQUIRED_CONSENTS.filter((c) => grantedSet.has(c));
  const consentsNeeded = REQUIRED_CONSENTS.filter((c) => !grantedSet.has(c));

  return {
    kind,
    modality,
    modalitySource,
    language,
    spokenLanguages,
    consentsAlreadyGranted,
    consentsNeeded,
    sessionsCompleted: completedCount,
    lastInstrumentAdministrations: {
      PHQ9: phq9Latest?.administeredAt.toISOString() ?? null,
      GAD7: gad7Latest?.administeredAt.toISOString() ?? null,
    },
    lastCompletedSessionAt: lastCompleted?.endedAt?.toISOString() ?? null,
  };
}

/**
 * Decide whether the kind/modality the therapist submitted differs
 * from what the cascade picked. Used by the session-create route to
 * write SESSION_MODALITY_OVERRIDDEN when the therapist changed it.
 */
export function modalityWasOverridden(
  cascade: SessionModality | null,
  submitted: SessionModality | null | undefined,
): boolean {
  if (submitted === undefined) return false;
  return submitted !== cascade;
}

// ============================================================================
// Helpers.
// ============================================================================

export class SessionDefaultsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionDefaultsError';
  }
}

function readPlanModality(body: unknown): SessionModality | null {
  if (!body || typeof body !== 'object') return null;
  const modality = (body as { modality?: string }).modality;
  if (typeof modality !== 'string') return null;
  // The TreatmentPlan body uses ClinicalPlanModality which overlaps
  // with SessionModality but adds "supportive"/"mixed"/"other".
  // Map to SessionModality where possible; else return null so the
  // cascade falls through to a lower-priority source.
  switch (modality.toUpperCase()) {
    case 'CBT':
      return 'CBT';
    case 'EMDR':
      return 'EMDR';
    case 'ACT':
      return 'ACT';
    case 'IFS':
      return 'IFS';
    case 'PSYCHODYNAMIC':
      return 'PSYCHODYNAMIC';
    case 'MI':
      return 'MI';
    case 'MBCT':
      return 'MBCT';
    case 'SUPPORTIVE':
      return 'SUPPORTIVE';
    case 'OTHER':
    case 'MIXED':
      return 'OTHER';
    default:
      return null;
  }
}

function parseLocale(raw: string | null | undefined): ClinicalLocale {
  if (!raw) return 'en';
  const parsed = ClinicalLocaleSchema.safeParse(raw);
  return parsed.success ? parsed.data : 'en';
}
