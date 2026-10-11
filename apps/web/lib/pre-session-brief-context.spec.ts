import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PreSessionBriefV1Schema } from '@cureocity/contracts';

const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  session: vi.fn(),
  diagnosis: vi.fn(),
  plan: vi.fn(),
  count: vi.fn(),
  instruments: vi.fn(),
  homework: vi.fn(),
  crises: vi.fn(),
  gather: vi.fn(),
  serialise: vi.fn(),
}));
vi.mock('./prisma', () => ({
  prisma: {
    client: { findFirst: mocks.client },
    session: { findFirst: mocks.session, count: mocks.count },
    clientDiagnosis: { findFirst: mocks.diagnosis },
    treatmentPlan: { findFirst: mocks.plan },
    instrumentResponse: { findMany: mocks.instruments },
    exerciseAssignment: { findFirst: mocks.homework },
  },
}));
vi.mock('./case-briefing', () => ({
  gatherInputs: mocks.gather,
  serialiseContext: mocks.serialise,
}));
vi.mock('./crisis-flags', () => ({ fetchOpenCrises: mocks.crises }));

import {
  briefContextFingerprint,
  briefMatchesContext,
  loadPreSessionBriefContext,
  withBriefContext,
} from './pre-session-brief-context';

const client = {
  presentingConcerns: 'Fictional concern',
  preferredLanguage: 'en',
  carriedQuestions: [],
};
const note = {
  subjective: 'x'.repeat(350),
  assessment: 'Fictional assessment',
  plan: 'Fictional plan',
};
const session = {
  id: 'session-1',
  kind: 'TREATMENT',
  therapyNote: { content: note },
  noteDraft: { content: { ...note, plan: 'old' } },
};
const plan = {
  id: 'plan-1',
  body: {
    modality: 'CBT',
    phaseSequence: ['Assess', 'Review'],
    goals: [{ description: 'Fictional goal', measure: 'Client report' }],
    expectedDurationSessions: 8,
  },
};
const brief = PreSessionBriefV1Schema.parse({
  version: 'V1',
  contextLine: 'Saved context',
  lastSessionRecap: '',
  todaysFocus: 'Review together',
  openingLine: 'Where should we begin?',
  homeworkStatus: null,
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.client.mockResolvedValue(client);
  mocks.session.mockResolvedValue(session);
  mocks.diagnosis.mockResolvedValue(null);
  mocks.plan.mockResolvedValue(plan);
  mocks.count.mockResolvedValue(1);
  mocks.instruments.mockResolvedValue([]);
  mocks.homework.mockResolvedValue(null);
  mocks.crises.mockResolvedValue([]);
  mocks.gather.mockResolvedValue({});
  mocks.serialise.mockReturnValue('Fictional case digest');
});
const load = () => loadPreSessionBriefContext('client-1', 'psy-1', 'en');

describe('read-only pre-session grounding fingerprint', () => {
  it('is stable for unchanged data regardless of object-key order', async () => {
    expect(briefContextFingerprint({ a: 1, b: 2 })).toBe(briefContextFingerprint({ b: 2, a: 1 }));
    expect((await load()).fingerprint).toBe((await load()).fingerprint);
  });
  it.each(['plan', 'concerns', 'signed-note', 'clipped-note', 'homework', 'digest'] as const)(
    'becomes stale after a %s change without a new session',
    async (field) => {
      const previous = await load();
      if (field === 'plan')
        mocks.plan.mockResolvedValue({
          ...plan,
          id: 'plan-2',
          body: { ...plan.body, expectedDurationSessions: 12 },
        });
      if (field === 'concerns')
        mocks.client.mockResolvedValue({ ...client, presentingConcerns: 'Corrected concern' });
      if (field === 'signed-note')
        mocks.session.mockResolvedValue({
          ...session,
          therapyNote: { content: { ...note, plan: 'Corrected final plan' } },
        });
      if (field === 'clipped-note')
        mocks.session.mockResolvedValue({
          ...session,
          therapyNote: { content: { ...note, subjective: note.subjective + 'corrected ending' } },
        });
      if (field === 'homework')
        mocks.homework.mockResolvedValue({
          id: 'hw-1',
          status: 'IN_PROGRESS',
          customDescription: 'Fictional task',
          therapistNote: null,
          exerciseId: null,
          response: { outcome: 'PARTLY' },
        });
      if (field === 'digest') mocks.serialise.mockReturnValue('Changed current case digest');
      const current = await load();
      expect(current.lastSessionId).toBe(previous.lastSessionId);
      expect(
        briefMatchesContext(withBriefContext(brief, previous.fingerprint), current.fingerprint),
      ).toBe(false);
    },
  );
  it('binds the selected signed note, not subsequent changes to a superseded draft', async () => {
    const previous = await load();
    mocks.session.mockResolvedValue({
      ...session,
      noteDraft: { content: { ...note, plan: 'Draft no longer authoritative' } },
    });
    expect((await load()).fingerprint).toBe(previous.fingerprint);
  });
  it('marks legacy or malformed metadata stale and strips private metadata from the public DTO', async () => {
    const context = await load();
    expect(briefMatchesContext(brief, context.fingerprint)).toBe(false);
    expect(
      briefMatchesContext(
        { ...brief, _mindBriefContext: { version: 99, fingerprint: context.fingerprint } },
        context.fingerprint,
      ),
    ).toBe(false);
    const saved = withBriefContext(brief, context.fingerprint);
    expect(briefMatchesContext(saved, context.fingerprint)).toBe(true);
    expect(PreSessionBriefV1Schema.parse(saved)).not.toHaveProperty('_mindBriefContext');
  });
  it('cannot certify freshness when cumulative context fails to load', async () => {
    mocks.gather.mockRejectedValue(new Error('unavailable'));
    const context = await load();
    expect(context.fingerprint).toBeNull();
    expect(briefMatchesContext(withBriefContext(brief, null), null)).toBe(false);
  });
  it('uses final intake fields in the model input', async () => {
    mocks.session.mockResolvedValue({
      ...session,
      kind: 'INTAKE',
      therapyNote: {
        content: {
          presentingConcerns: 'Saved concern',
          historyOfPresentingIllness: 'Saved history',
          workingHypothesis: 'Hypothesis only',
          immediatePlan: 'Agreed next step',
        },
      },
    });
    expect((await load()).input.lastSessionSummary).toContain(
      'Working hypothesis: Hypothesis only',
    );
  });
});
