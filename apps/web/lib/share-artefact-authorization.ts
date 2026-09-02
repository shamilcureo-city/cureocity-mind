import type { PractitionerCapability, ShareArtefactRef } from '@cureocity/contracts';

export type ShareArtefactVertical = 'THERAPIST' | 'DOCTOR';

export interface ShareArtefactAuthorizationPolicy {
  vertical: ShareArtefactVertical;
  requiredCapabilities: readonly [
    'PATIENT_SHARING',
    Exclude<PractitionerCapability, 'PATIENT_SHARING'>,
  ];
}

const MIND_SHARE_POLICY = {
  vertical: 'THERAPIST',
  requiredCapabilities: ['PATIENT_SHARING', 'BEHAVIORAL_HEALTH_DOCUMENTATION'],
} as const satisfies ShareArtefactAuthorizationPolicy;

const SCRIBE_SHARE_POLICY = {
  vertical: 'DOCTOR',
  requiredCapabilities: ['PATIENT_SHARING', 'MEDICAL_DOCUMENTATION'],
} as const satisfies ShareArtefactAuthorizationPolicy;

/**
 * Exhaustive authorization boundary for the generic share route.
 *
 * Keep this keyed by the ShareArtefactRef discriminator: adding a contracts
 * branch without assigning a vertical and least-required capabilities must be
 * a type error (and is also guarded by the route's runtime matrix test).
 */
export const SHARE_ARTEFACT_AUTHORIZATION_POLICY = {
  SIGNED_NOTE: MIND_SHARE_POLICY,
  REFLECTION_QUESTIONS: MIND_SHARE_POLICY,
  THERAPY_SCRIPT: MIND_SHARE_POLICY,
  TREATMENT_PLAN: MIND_SHARE_POLICY,
  PROGRESS_REPORT: MIND_SHARE_POLICY,
  INSTRUMENT_CHECKIN: MIND_SHARE_POLICY,
  SIGNED_INTAKE_NOTE: MIND_SHARE_POLICY,
  AFTER_VISIT_SUMMARY: SCRIBE_SHARE_POLICY,
  CHRONIC_PROGRESS_REPORT: SCRIBE_SHARE_POLICY,
  RX_PAD: SCRIBE_SHARE_POLICY,
  HOMEWORK: MIND_SHARE_POLICY,
  SESSION_TAKEAWAY: MIND_SHARE_POLICY,
} as const satisfies Record<ShareArtefactRef['artefactType'], ShareArtefactAuthorizationPolicy>;

export function shareArtefactAuthorizationPolicy(
  artefactType: ShareArtefactRef['artefactType'],
): ShareArtefactAuthorizationPolicy {
  return SHARE_ARTEFACT_AUTHORIZATION_POLICY[artefactType];
}
