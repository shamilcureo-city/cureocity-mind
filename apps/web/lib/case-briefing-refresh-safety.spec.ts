import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaseBriefingV1 } from '@cureocity/contracts';

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  gather: vi.fn(),
  compose: vi.fn(),
  pass6: vi.fn(),
  audit: vi.fn(),
  log: vi.fn(),
}));
vi.mock('./auth-server', () => ({ requirePsychologistId: m.auth }));
vi.mock('./case-briefing', () => ({
  gatherInputs: m.gather,
  composeBriefing: m.compose,
  serialiseContext: () => 'Fictional context',
  buildDeterministicCaseBriefing: vi.fn(),
}));
vi.mock('./prisma', () => ({ prisma: { geminiCallLog: { create: m.log } } }));
vi.mock('./llm', () => ({ modelRouter: () => ({ pass6: m.pass6 }) }));
vi.mock('./audit', () => ({ writeAudit: m.audit, auditMetadataFromRequest: () => ({}) }));
vi.mock('@cureocity/observability/metrics', () => ({ recordGeminiCall: vi.fn() }));
import { POST } from '../app/api/v1/clients/[id]/case-briefing/route';

const deterministic: CaseBriefingV1 = {
  version: 'V1',
  headline: 'Shared care plan',
  formulation: {
    presenting: 'Fictional',
    predisposing: '',
    precipitating: '',
    perpetuating: '',
    protective: '',
  },
  workingDiagnosis: null,
  openItems: [],
  nextActions: [
    {
      title: 'Review documented safety concerns with the client',
      detail: 'Review the unfinished source note in context.',
      why: 'Safety context requires review.',
      when: 'this_session',
      ctaLabel: null,
      ctaHref: null,
    },
  ],
  cadence: {
    recommendedIntervalDays: 7,
    rationale: 'Agree timing together after safety review.',
    reviewDueInSessions: null,
  },
  safety: {
    highestSeverity: 'critical',
    hasSafetyPlan: false,
    openCrisisFlags: ['Unfinished clinician-written draft'],
    clinicianDocumentedRisk: {
      severity: 'critical',
      sourceSessionId: 'unfinished-source',
      recordedAt: '2026-09-01T10:00:00.000Z',
      sourceStatus: 'UNFINISHED',
    },
  },
  generatedAt: '2026-09-01T10:00:00.000Z',
  source: 'deterministic',
};
beforeEach(() => {
  vi.resetAllMocks();
  m.auth.mockResolvedValue({
    ok: true,
    value: { psychologistId: 'owner', user: { vertical: 'THERAPIST' } },
  });
  m.gather.mockResolvedValue({});
  m.compose.mockReturnValue(deterministic);
});

describe('briefing narrative refresh keeps deterministic safety and clinical decision boundaries', () => {
  it('does not let a successful narrative erase manual-note provenance or recommend score-only ending', async () => {
    m.pass6.mockResolvedValue({
      output: {
        caseBriefing: {
          ...deterministic,
          headline: 'Refined fictional narrative',
          safety: { highestSeverity: 'none', hasSafetyPlan: false, openCrisisFlags: [] },
          nextActions: [
            {
              ...deterministic.nextActions[0],
              title: 'Consider discharge because the score improved',
            },
          ],
          cadence: {
            recommendedIntervalDays: 30,
            rationale: 'Score improved',
            reviewDueInSessions: null,
          },
        },
      },
      callLog: { pass: 'PASS6', status: 'COMPLETED', region: 'test', latencyMs: 1 },
    });
    const response = await POST(
      new Request('http://localhost/api/v1/clients/fictional/case-briefing', {
        method: 'POST',
      }) as never,
      { params: Promise.resolve({ id: 'fictional' }) },
    );
    expect(response.status).toBe(200);
    const { briefing } = await response.json();
    expect(briefing.headline).toBe('Refined fictional narrative');
    expect(briefing.source).toBe('llm');
    expect(briefing.safety).toEqual(deterministic.safety);
    expect(briefing.nextActions).toEqual(deterministic.nextActions);
    expect(briefing.cadence).toEqual(deterministic.cadence);
    expect(m.log).toHaveBeenCalledTimes(1);
    expect(m.audit).toHaveBeenCalledTimes(1);
  });
});
