import { describe, expect, it } from 'vitest';
import { ModalitySourceSchema, SessionDefaultsSchema } from './session';

describe('ModalitySourceSchema (Sprint 19)', () => {
  it.each(['plan', 'client', 'therapist', 'intake-fallback', 'last-resort'])(
    'accepts %s',
    (source) => {
      expect(ModalitySourceSchema.safeParse(source).success).toBe(true);
    },
  );

  it.each(['default', 'fallback', 'plan-active', ''])('rejects %s', (source) => {
    expect(ModalitySourceSchema.safeParse(source).success).toBe(false);
  });
});

describe('SessionDefaultsSchema (Sprint 19 — Pre-Flight panel payload)', () => {
  const baseline = {
    kind: 'INTAKE' as const,
    modality: 'CBT' as const,
    modalitySource: 'therapist' as const,
    language: 'en' as const,
    spokenLanguages: ['en', 'ml'],
    consentsAlreadyGranted: ['AUDIO_RECORDING', 'AI_NOTE_GENERATION'],
    consentsNeeded: ['CROSS_BORDER_PROCESSING'],
    sessionsCompleted: 0,
    lastInstrumentAdministrations: {
      PHQ9: null,
      GAD7: '2026-05-12T10:00:00.000Z',
    },
  };

  it('accepts a fully-populated payload', () => {
    expect(SessionDefaultsSchema.safeParse(baseline).success).toBe(true);
  });

  it('accepts a null modality (deferred from intake)', () => {
    expect(SessionDefaultsSchema.safeParse({ ...baseline, modality: null }).success).toBe(true);
  });

  it('accepts all kinds', () => {
    for (const kind of ['INTAKE', 'TREATMENT', 'REVIEW'] as const) {
      expect(SessionDefaultsSchema.safeParse({ ...baseline, kind }).success).toBe(true);
    }
  });

  it('accepts all modality sources', () => {
    for (const modalitySource of [
      'plan',
      'client',
      'therapist',
      'intake-fallback',
      'last-resort',
    ] as const) {
      expect(SessionDefaultsSchema.safeParse({ ...baseline, modalitySource }).success).toBe(true);
    }
  });

  it('accepts every expanded SessionModality (CBT, EMDR, ACT, IFS, …)', () => {
    for (const modality of [
      'CBT',
      'EMDR',
      'ACT',
      'IFS',
      'PSYCHODYNAMIC',
      'MI',
      'MBCT',
      'SUPPORTIVE',
      'INTAKE',
      'OTHER',
    ] as const) {
      expect(SessionDefaultsSchema.safeParse({ ...baseline, modality }).success).toBe(true);
    }
  });

  it('accepts empty consent arrays (everything still missing)', () => {
    expect(
      SessionDefaultsSchema.safeParse({
        ...baseline,
        consentsAlreadyGranted: [],
        consentsNeeded: ['AUDIO_RECORDING', 'AI_NOTE_GENERATION', 'CROSS_BORDER_PROCESSING'],
      }).success,
    ).toBe(true);
  });

  it('accepts both null and ISO timestamps in instrument administrations', () => {
    expect(
      SessionDefaultsSchema.safeParse({
        ...baseline,
        lastInstrumentAdministrations: {
          PHQ9: null,
          GAD7: null,
        },
      }).success,
    ).toBe(true);
  });

  it('rejects a negative sessionsCompleted', () => {
    expect(SessionDefaultsSchema.safeParse({ ...baseline, sessionsCompleted: -1 }).success).toBe(
      false,
    );
  });

  it('rejects an unsupported language', () => {
    expect(SessionDefaultsSchema.safeParse({ ...baseline, language: 'fr' }).success).toBe(false);
  });

  it('rejects an unknown modalitySource', () => {
    expect(SessionDefaultsSchema.safeParse({ ...baseline, modalitySource: 'cache' }).success).toBe(
      false,
    );
  });

  it('rejects a non-integer sessionsCompleted', () => {
    expect(SessionDefaultsSchema.safeParse({ ...baseline, sessionsCompleted: 1.5 }).success).toBe(
      false,
    );
  });
});
