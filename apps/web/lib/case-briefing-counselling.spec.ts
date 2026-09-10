import { describe, expect, it, vi } from 'vitest';
import { CaseBriefingV1Schema, type InstrumentChange } from '@cureocity/contracts';
vi.mock('./prisma', () => ({ prisma: {} }));
vi.mock('./capabilities', () => ({ getEffectiveCapabilities: vi.fn() }));
vi.mock('./tenant-crypto', () => ({ decryptForTenant: vi.fn() }));
import { composeBriefing, serialiseContext, type CaseBriefingInputs } from './case-briefing';

const at = '2026-09-01T10:00:00.000Z';
function inputs(): CaseBriefingInputs {
  return {
    clientId: 'fictional-client',
    presentingConcerns: 'Fictional client priorities',
    intakeNote: null,
    latestReportBody: null,
    hasSafetyPlan: false,
    openItems: [],
    problems: [],
    instrumentSeries: [],
    diagnosisHistory: [],
    journey: {
      clientId: 'fictional-client',
      stage: 'ACTIVE_TREATMENT',
      sessionsCompleted: 4,
      lastSessionAt: at,
      workingDiagnosis: null,
      activePlan: {
        id: 'plan',
        version: 1,
        modality: 'SUPPORTIVE',
        goals: [
          {
            index: 0,
            description: 'Client-authored goal',
            measure: 'Everyday change',
            status: 'IN_PROGRESS',
          },
        ],
        goalsAchieved: 0,
        goalsTotal: 1,
        confirmedAt: at,
      },
      instrumentChanges: [],
      nextBestAction: null,
      closedEpisode: null,
    },
  };
}
function reading(over: Partial<InstrumentChange> = {}): InstrumentChange {
  return {
    instrumentKey: 'PHQ9',
    baselineScore: 18,
    latestScore: 3,
    delta: -15,
    percentChange: -83,
    verdict: 'reliable_improvement',
    isResponse: true,
    isRemission: true,
    baselineSeverityKey: 'moderately_severe',
    latestSeverityKey: 'minimal',
    administrationCount: 2,
    baselineAt: at,
    latestAt: at,
    ...over,
  };
}

describe('case briefing supports clinician-led counselling', () => {
  it('keeps manual-only critical safety context first and links the genuine source, with no AI report', () => {
    const input = inputs();
    input.clinicianDocumentedRisk = {
      severity: 'critical',
      sourceSessionId: 'manual-source',
      recordedAt: at,
      sourceStatus: 'COMPLETED',
    };
    const briefing = CaseBriefingV1Schema.parse(composeBriefing(input));
    expect(briefing.safety.highestSeverity).toBe('critical');
    expect(briefing.safety.clinicianDocumentedRisk).toEqual(input.clinicianDocumentedRisk);
    expect(briefing.nextActions[0]?.title).toBe(
      'Review documented safety concerns with the client',
    );
    expect(briefing.safety.openCrisisFlags[0]).toContain('Clinician-written note');
    expect(JSON.stringify(briefing)).not.toContain('reportId');
    expect(serialiseContext(input)).toContain('not an AI-confirmed or current risk assessment');
  });

  it('labels unfinished safety context as a draft rather than a confirmed note', () => {
    const input = inputs();
    input.clinicianDocumentedRisk = {
      severity: 'high',
      sourceSessionId: 'unfinished',
      recordedAt: at,
      sourceStatus: 'UNFINISHED',
    };
    const briefing = composeBriefing(input);
    expect(briefing.safety.openCrisisFlags[0]).toContain('unfinished draft');
    expect(serialiseContext(input)).toContain('unfinished draft');
  });

  it('prioritizes worsening when another instrument is in remission and does not widen cadence', () => {
    const input = inputs();
    input.journey.instrumentChanges = [
      reading(),
      reading({
        instrumentKey: 'GAD7',
        verdict: 'deterioration',
        isRemission: false,
        isResponse: false,
      }),
    ];
    const briefing = composeBriefing(input);
    expect(briefing.nextActions[0]?.title).toBe('Review worsening with the client');
    expect(briefing.nextActions[0]?.detail).toContain('even if another measure improved');
    expect(JSON.stringify(briefing.nextActions)).not.toMatch(/discharge|ending|end care/i);
    expect(briefing.cadence.recommendedIntervalDays).toBe(7);
    expect(briefing.cadence.rationale).toContain('does not justify longer gaps');
  });

  it('treats improved scores as a whole-case review, not readiness to end care', () => {
    const input = inputs();
    input.journey.instrumentChanges = [reading()];
    const action = composeBriefing(input).nextActions[0]!;
    expect(action.title).toBe('Review progress together');
    expect(action.detail).toContain('goals');
    expect(action.detail).toContain('client’s preference and safety');
    expect(action.detail).toContain('alone do not establish readiness');
  });

  it('does not manufacture diagnostic or mandatory baseline blockers for counselling', () => {
    const briefing = composeBriefing(inputs());
    expect(briefing.openItems).toEqual([]);
    expect(briefing.workingDiagnosis).toBeNull();
    expect(briefing.headline).toContain('agreed plan');
    expect(briefing.headline).not.toContain('differential');
    expect(briefing.nextActions[0]?.detail).toContain('optional');
    expect(briefing.nextActions[0]?.detail).toContain('no baseline is required');
    expect(briefing.safety.highestSeverity).toBe('none');
  });

  it('can agree a plan without a diagnosis and start without audio recording', () => {
    const input = inputs();
    input.journey.activePlan = null;
    expect(
      composeBriefing(input).nextActions.some((a) => a.title === 'Agree goals and a plan together'),
    ).toBe(true);
    input.journey.sessionsCompleted = 0;
    input.journey.stage = 'INTAKE';
    const action = composeBriefing(input).nextActions[0]!;
    expect(action.title).toBe('Start the first conversation');
    expect(action.detail).toContain('Audio recording is optional');
    expect(action.ctaHref).toBe('/app/clients/fictional-client');
  });
});
