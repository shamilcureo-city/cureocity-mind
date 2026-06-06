import { describe, expect, it } from 'vitest';
import {
  PatientShareSnapshotSchema,
  PatientShareTokenSchema,
  ShareInputSchema,
} from './share';

describe('PatientShareTokenSchema', () => {
  it('accepts a 22-char base64url token', () => {
    // 16 bytes → 22 chars base64url
    const sample = 'AbCdEfGhIjKlMnOpQrStUv';
    expect(PatientShareTokenSchema.safeParse(sample).success).toBe(true);
  });

  it.each([
    'short',
    'has spaces in here     ',
    'AbCdEfGhIjKlMnOpQrStUv!',
    'AbCdEfGhIjKlMnOpQrStU', // 21 chars
    'AbCdEfGhIjKlMnOpQrStUvW', // 23 chars
  ])('rejects malformed token %s', (sample) => {
    expect(PatientShareTokenSchema.safeParse(sample).success).toBe(false);
  });
});

describe('PatientShareSnapshotSchema (discriminated union)', () => {
  it('accepts a signed note snapshot', () => {
    const sample = {
      kind: 'SIGNED_NOTE' as const,
      subjective: 'S',
      objective: 'O',
      assessment: 'A',
      plan: 'P',
      pdfUrl: null,
    };
    expect(PatientShareSnapshotSchema.safeParse(sample).success).toBe(true);
  });

  it('accepts a reflection questions snapshot with up to 10 items', () => {
    const sample = {
      kind: 'REFLECTION_QUESTIONS' as const,
      questions: Array.from({ length: 10 }, (_, i) => `Question ${i + 1}`),
    };
    expect(PatientShareSnapshotSchema.safeParse(sample).success).toBe(true);
  });

  it('rejects reflection questions with 11 items', () => {
    const sample = {
      kind: 'REFLECTION_QUESTIONS' as const,
      questions: Array.from({ length: 11 }, (_, i) => `Question ${i + 1}`),
    };
    expect(PatientShareSnapshotSchema.safeParse(sample).success).toBe(false);
  });

  it('accepts a therapy script snapshot with patient summary + homework', () => {
    const sample = {
      kind: 'THERAPY_SCRIPT' as const,
      therapyName: 'Cognitive Restructuring',
      patientSummary: 'We worked on the thoughts behind anxiety.',
      homework: {
        description: 'Catch one thought a day.',
        deliveryNotes: 'Use the notes app.',
      },
    };
    expect(PatientShareSnapshotSchema.safeParse(sample).success).toBe(true);
  });

  it('accepts a treatment plan snapshot', () => {
    const sample = {
      kind: 'TREATMENT_PLAN' as const,
      modality: 'CBT',
      phaseSequence: ['psychoed', 'restructuring'],
      goals: [{ description: 'Reduce GAD-7 by 4', measure: 'GAD-7 q4 sessions' }],
      expectedDurationSessions: 12,
    };
    expect(PatientShareSnapshotSchema.safeParse(sample).success).toBe(true);
  });

  it('rejects an unknown discriminator', () => {
    expect(PatientShareSnapshotSchema.safeParse({ kind: 'OTHER' }).success).toBe(false);
  });
});

describe('ShareInputSchema', () => {
  const cuid = 'c123456789012345678901234'; // 25-char placeholder; CuidSchema is `cuid` permissive

  it('rejects when channels is empty', () => {
    expect(
      ShareInputSchema.safeParse({
        clientId: cuid,
        channels: [],
        artefact: { artefactType: 'SIGNED_NOTE', sessionId: cuid },
      }).success,
    ).toBe(false);
  });

  it('accepts a SIGNED_NOTE share with one channel', () => {
    expect(
      ShareInputSchema.safeParse({
        clientId: cuid,
        channels: ['WHATSAPP'],
        artefact: { artefactType: 'SIGNED_NOTE', sessionId: cuid },
      }).success,
    ).toBe(true);
  });

  it('accepts a REFLECTION_QUESTIONS share with the questions inline', () => {
    expect(
      ShareInputSchema.safeParse({
        clientId: cuid,
        channels: ['EMAIL', 'PORTAL_LINK'],
        therapistMessage: 'Sit with these between sessions.',
        artefact: {
          artefactType: 'REFLECTION_QUESTIONS',
          sessionId: cuid,
          questions: ['What did you notice?', 'When did it shift?'],
        },
      }).success,
    ).toBe(true);
  });

  it('rejects REFLECTION_QUESTIONS with empty questions array', () => {
    expect(
      ShareInputSchema.safeParse({
        clientId: cuid,
        channels: ['WHATSAPP'],
        artefact: {
          artefactType: 'REFLECTION_QUESTIONS',
          sessionId: cuid,
          questions: [],
        },
      }).success,
    ).toBe(false);
  });

  it('accepts a THERAPY_SCRIPT share', () => {
    expect(
      ShareInputSchema.safeParse({
        clientId: cuid,
        channels: ['PORTAL_LINK'],
        artefact: { artefactType: 'THERAPY_SCRIPT', therapyScriptId: cuid },
      }).success,
    ).toBe(true);
  });

  it('accepts a TREATMENT_PLAN share', () => {
    expect(
      ShareInputSchema.safeParse({
        clientId: cuid,
        channels: ['WHATSAPP', 'EMAIL'],
        artefact: { artefactType: 'TREATMENT_PLAN', treatmentPlanId: cuid },
      }).success,
    ).toBe(true);
  });

  it('rejects unknown extra fields (strict)', () => {
    expect(
      ShareInputSchema.safeParse({
        clientId: cuid,
        channels: ['WHATSAPP'],
        artefact: { artefactType: 'SIGNED_NOTE', sessionId: cuid },
        rogueField: 'should fail',
      }).success,
    ).toBe(false);
  });

  it('rejects > 3 channels', () => {
    expect(
      ShareInputSchema.safeParse({
        clientId: cuid,
        channels: ['WHATSAPP', 'EMAIL', 'PORTAL_LINK', 'WHATSAPP'],
        artefact: { artefactType: 'SIGNED_NOTE', sessionId: cuid },
      }).success,
    ).toBe(false);
  });
});
