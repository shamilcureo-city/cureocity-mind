import type { SessionStatus } from '@cureocity/contracts';
import type { EncounterProfile } from './domain';

export type EncounterCaptureStrategy =
  | 'BATCH_AMBIENT'
  | 'LIVE_STREAM'
  | 'DICTATION'
  | 'MANUAL'
  | 'UPLOAD';

export type EncounterTransition = 'START' | 'COMPLETE' | 'CANCEL' | 'MARK_NO_SHOW' | 'RESCHEDULE';

export interface EncounterProfileDefinition {
  profile: EncounterProfile;
  allowedCaptureStrategies: readonly EncounterCaptureStrategy[];
  requiresConsentBeforeStart: boolean;
}

const TERMINAL_STATUSES: ReadonlySet<SessionStatus> = new Set([
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
  'RESCHEDULED',
]);

const TRANSITIONS: Record<EncounterTransition, Partial<Record<SessionStatus, SessionStatus>>> = {
  START: { SCHEDULED: 'IN_PROGRESS' },
  COMPLETE: { IN_PROGRESS: 'COMPLETED' },
  CANCEL: { SCHEDULED: 'CANCELLED' },
  MARK_NO_SHOW: { SCHEDULED: 'NO_SHOW' },
  RESCHEDULE: { SCHEDULED: 'RESCHEDULED' },
};

const BEHAVIORAL_CAPTURE: readonly EncounterCaptureStrategy[] = [
  'BATCH_AMBIENT',
  'DICTATION',
  'MANUAL',
  'UPLOAD',
];
const MEDICAL_CAPTURE: readonly EncounterCaptureStrategy[] = [
  'LIVE_STREAM',
  'DICTATION',
  'MANUAL',
  'UPLOAD',
];

export function encounterProfileDefinition(profile: EncounterProfile): EncounterProfileDefinition {
  return {
    profile,
    allowedCaptureStrategies: profile.startsWith('MEDICAL_') ? MEDICAL_CAPTURE : BEHAVIORAL_CAPTURE,
    requiresConsentBeforeStart: true,
  };
}

export function transitionEncounter(
  current: SessionStatus,
  transition: EncounterTransition,
): SessionStatus {
  const next = TRANSITIONS[transition][current];
  if (!next) throw new InvalidEncounterTransitionError(current, transition);
  return next;
}

export function canTransitionEncounter(
  current: SessionStatus,
  transition: EncounterTransition,
): boolean {
  return TRANSITIONS[transition][current] !== undefined;
}

export function isEncounterTerminal(status: SessionStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export class InvalidEncounterTransitionError extends Error {
  constructor(
    readonly current: SessionStatus,
    readonly transition: EncounterTransition,
  ) {
    super(
      `Cannot ${transition.toLowerCase().replaceAll('_', ' ')} an encounter in ${current} state`,
    );
    this.name = 'InvalidEncounterTransitionError';
  }
}
