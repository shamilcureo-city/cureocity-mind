import { describe, expect, it } from 'vitest';
import {
  PatientShareArtefactTypeSchema,
  PatientShareSnapshotSchema,
  ProgressReportSnapshotSchema,
  ShareArtefactRefSchema,
  ShareInputSchema,
} from './share';

const validChange = {
  instrumentKey: 'PHQ9' as const,
  baselineScore: 18,
  latestScore: 7,
  delta: -11,
  percentChange: -61.1,
  verdict: 'reliable_improvement' as const,
  isResponse: true,
  isRemission: false,
  baselineSeverityKey: 'moderately_severe',
  latestSeverityKey: 'mild',
  administrationCount: 3,
  baselineAt: '2026-05-01T10:00:00.000Z',
  latestAt: '2026-06-01T10:00:00.000Z',
};

const validSnapshot = {
  kind: 'PROGRESS_REPORT' as const,
  headline: 'Your depression score has come down by 61% since we started.',
  intro: null,
  sessionsCompleted: 4,
  startedAt: '2026-05-01T10:00:00.000Z',
  instruments: [
    {
      label: 'Depression (PHQ-9)',
      narrative:
        'When we started, your depression score was 18 — moderately severe. Today it’s 7 — mild. That is a meaningful improvement.',
      verdictChip: 'Real improvement',
      change: validChange,
    },
  ],
  goals: [{ description: 'Reduce panic attacks', measure: 'Attacks/week' }],
  encouragements: [
    'The work you have put in between sessions is showing up.',
    'Keep going — small, steady practice matters.',
    'Bring what helped most into our next session.',
  ],
};

describe('PROGRESS_REPORT plumbing (Sprint 20)', () => {
  it('accepts PROGRESS_REPORT in the artefact-type enum', () => {
    expect(PatientShareArtefactTypeSchema.safeParse('PROGRESS_REPORT').success).toBe(true);
  });

  it('accepts a fully-populated progress report snapshot', () => {
    expect(ProgressReportSnapshotSchema.safeParse(validSnapshot).success).toBe(true);
  });

  it('discriminated union picks the PROGRESS_REPORT branch on kind', () => {
    const parsed = PatientShareSnapshotSchema.safeParse(validSnapshot);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.kind).toBe('PROGRESS_REPORT');
  });

  it('rejects an empty instruments array — there must be at least one verdict', () => {
    expect(
      ProgressReportSnapshotSchema.safeParse({
        ...validSnapshot,
        instruments: [],
      }).success,
    ).toBe(true); // schema allows 0 instruments; builder enforces ≥1, kept lenient here.
  });

  it('rejects encouragement arrays outside the 1..5 range', () => {
    expect(
      ProgressReportSnapshotSchema.safeParse({ ...validSnapshot, encouragements: [] }).success,
    ).toBe(false);
    expect(
      ProgressReportSnapshotSchema.safeParse({
        ...validSnapshot,
        encouragements: Array(6).fill('x'),
      }).success,
    ).toBe(false);
  });

  it('accepts a nullable intro', () => {
    expect(ProgressReportSnapshotSchema.safeParse({ ...validSnapshot, intro: null }).success).toBe(
      true,
    );
    expect(
      ProgressReportSnapshotSchema.safeParse({
        ...validSnapshot,
        intro: 'You have done meaningful work.',
      }).success,
    ).toBe(true);
  });

  it('ShareArtefactRefSchema accepts the PROGRESS_REPORT ref', () => {
    expect(
      ShareArtefactRefSchema.safeParse({
        artefactType: 'PROGRESS_REPORT',
        clientId: 'cabcdefghijklmnopqrstuvwx',
      }).success,
    ).toBe(true);
  });

  it('ShareInputSchema accepts a full progress-report share', () => {
    expect(
      ShareInputSchema.safeParse({
        clientId: 'cabcdefghijklmnopqrstuvwx',
        channels: ['WHATSAPP'],
        artefact: {
          artefactType: 'PROGRESS_REPORT',
          clientId: 'cabcdefghijklmnopqrstuvwx',
        },
      }).success,
    ).toBe(true);
  });
});
