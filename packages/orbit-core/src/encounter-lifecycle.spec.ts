import { describe, expect, it } from 'vitest';
import {
  canTransitionEncounter,
  encounterProfileDefinition,
  InvalidEncounterTransitionError,
  isEncounterTerminal,
  transitionEncounter,
} from './encounter-lifecycle';

describe('Encounter lifecycle', () => {
  it('enforces the shared happy path and terminal states', () => {
    expect(transitionEncounter('SCHEDULED', 'START')).toBe('IN_PROGRESS');
    expect(transitionEncounter('IN_PROGRESS', 'COMPLETE')).toBe('COMPLETED');
    expect(isEncounterTerminal('COMPLETED')).toBe(true);
    expect(canTransitionEncounter('COMPLETED', 'START')).toBe(false);
  });

  it.each(['CANCEL', 'MARK_NO_SHOW', 'RESCHEDULE'] as const)(
    'permits %s only before an encounter starts',
    (transition) => {
      expect(canTransitionEncounter('SCHEDULED', transition)).toBe(true);
      expect(() => transitionEncounter('IN_PROGRESS', transition)).toThrow(
        InvalidEncounterTransitionError,
      );
    },
  );

  it('registers capture strategies by encounter profile', () => {
    expect(
      encounterProfileDefinition('BEHAVIORAL_HEALTH_FOLLOWUP').allowedCaptureStrategies,
    ).toContain('BATCH_AMBIENT');
    expect(encounterProfileDefinition('MEDICAL_CONSULT').allowedCaptureStrategies).toContain(
      'LIVE_STREAM',
    );
    expect(encounterProfileDefinition('MEDICAL_CONSULT').requiresConsentBeforeStart).toBe(true);
  });
});
