import { describe, expect, it } from 'vitest';
import {
  DischargeClientInputSchema,
  TERMINAL_EPISODE_STATUSES,
  TreatmentEpisodeSchema,
  TreatmentEpisodeStatusSchema,
} from './episode';
import { JourneyStageSchema, JourneySummarySchema } from './journey';

describe('TreatmentEpisodeStatusSchema (Sprint 20 Phase 3)', () => {
  it.each(['OPEN', 'DISCHARGED', 'TRANSFERRED'])('accepts %s', (s) => {
    expect(TreatmentEpisodeStatusSchema.safeParse(s).success).toBe(true);
  });

  it('rejects PAUSED (not modelled at the episode level)', () => {
    expect(TreatmentEpisodeStatusSchema.safeParse('PAUSED').success).toBe(false);
  });

  it('TERMINAL_EPISODE_STATUSES are the two closed states', () => {
    expect(TERMINAL_EPISODE_STATUSES).toEqual(['DISCHARGED', 'TRANSFERRED']);
  });
});

describe('TreatmentEpisodeSchema', () => {
  const base = {
    id: 'cabcdefghijklmnopqrstuvwx',
    clientId: 'cclient1111111111111111aa',
    psychologistId: 'cpsy11111111111111111111a',
    status: 'OPEN' as const,
    openedAt: '2026-05-01T10:00:00.000Z',
    closedAt: null,
    closeReason: null,
    outcomeNote: null,
    createdAt: '2026-05-01T10:00:00.000Z',
    updatedAt: '2026-05-01T10:00:00.000Z',
  };

  it('accepts an open episode', () => {
    expect(TreatmentEpisodeSchema.safeParse(base).success).toBe(true);
  });

  it('accepts a closed episode with reason + outcome', () => {
    expect(
      TreatmentEpisodeSchema.safeParse({
        ...base,
        status: 'DISCHARGED',
        closedAt: '2026-07-01T10:00:00.000Z',
        closeReason: 'Goals met, symptoms in remission.',
        outcomeNote: 'Great progress over 10 sessions.',
      }).success,
    ).toBe(true);
  });
});

describe('DischargeClientInputSchema', () => {
  it('accepts a discharge with a reason', () => {
    expect(
      DischargeClientInputSchema.safeParse({
        status: 'DISCHARGED',
        reason: 'Treatment goals achieved.',
      }).success,
    ).toBe(true);
  });

  it('accepts a transfer with an outcome note', () => {
    expect(
      DischargeClientInputSchema.safeParse({
        status: 'TRANSFERRED',
        reason: 'Referred to a psychiatrist for medication review.',
        outcomeNote: 'Anxiety improved; depression needs pharmacological support.',
      }).success,
    ).toBe(true);
  });

  it('rejects OPEN as a discharge status', () => {
    expect(DischargeClientInputSchema.safeParse({ status: 'OPEN', reason: 'x' }).success).toBe(
      false,
    );
  });

  it('rejects an empty reason', () => {
    expect(DischargeClientInputSchema.safeParse({ status: 'DISCHARGED', reason: '' }).success).toBe(
      false,
    );
  });
});

describe('JourneyStageSchema gains DISCHARGED (Sprint 20 Phase 3)', () => {
  it('accepts DISCHARGED', () => {
    expect(JourneyStageSchema.safeParse('DISCHARGED').success).toBe(true);
  });

  it('JourneySummary accepts a closedEpisode block on a discharged arc', () => {
    expect(
      JourneySummarySchema.safeParse({
        clientId: 'cclient1111111111111111aa',
        stage: 'DISCHARGED',
        sessionsCompleted: 10,
        lastSessionAt: '2026-07-01T10:00:00.000Z',
        workingDiagnosis: null,
        activePlan: null,
        instrumentChanges: [],
        nextBestAction: null,
        closedEpisode: {
          status: 'DISCHARGED',
          closedAt: '2026-07-02T10:00:00.000Z',
          closeReason: 'Goals met.',
        },
      }).success,
    ).toBe(true);
  });

  it('JourneySummary accepts a null closedEpisode on an active arc', () => {
    expect(
      JourneySummarySchema.safeParse({
        clientId: 'cclient1111111111111111aa',
        stage: 'ACTIVE_TREATMENT',
        sessionsCompleted: 3,
        lastSessionAt: '2026-07-01T10:00:00.000Z',
        workingDiagnosis: null,
        activePlan: null,
        instrumentChanges: [],
        nextBestAction: null,
        closedEpisode: null,
      }).success,
    ).toBe(true);
  });
});
