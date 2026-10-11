import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock('./journey', () => ({
  computeClientJourney: async () => ({
    stage: 'ASSESSMENT',
    sessionsCompleted: 1,
    workingDiagnosis: null,
    activePlan: null,
    instrumentChanges: [],
  }),
}));
vi.mock('./clinician-documented-risk', () => ({
  fetchClinicianDocumentedRisk: async () => null,
  withClinicianRisk: vi.fn(),
}));
vi.mock('./prisma', () => ({
  prisma: {
    assessmentItem: { findMany: async () => [] },
    client: { findUnique: async () => ({ presentingConcerns: 'Client concern' }) },
    clinicalReport: { findFirst: async () => null },
    session: { findFirst: mocks.session },
    safetyPlan: { findFirst: async () => null },
    problemListItem: { findMany: async () => [] },
    instrumentResponse: { findMany: async () => [] },
    clientDiagnosis: { findMany: async () => [] },
  },
}));
import { gatherInputs, serialiseContext } from './case-briefing';
const intake = {
  version: 'V1',
  presentingConcerns: 'Intake concern',
  historyOfPresentingIllness: 'Reviewed history',
  pastPsychiatricHistory: '',
  familyHistory: '',
  socialHistory: '',
  mentalStatusExam: 'Recorded exam',
  workingHypothesis: 'Reviewed hypothesis',
  immediatePlan: 'Agreed next step',
  riskFlags: { severity: 'none' },
};
beforeEach(() => {
  vi.clearAllMocks();
});
describe('canonical intake in the cumulative case digest', () => {
  it('uses revised signed intake rather than the obsolete draft for all brief grounding', async () => {
    mocks.session.mockResolvedValue({
      therapyNote: { content: intake },
      noteDraft: {
        content: {
          ...intake,
          historyOfPresentingIllness: 'Obsolete history',
          workingHypothesis: 'Obsolete hypothesis',
        },
      },
    });
    const digest = serialiseContext(await gatherInputs('client-1', 'psy-1'));
    expect(digest).toContain('Reviewed history');
    expect(digest).toContain('Reviewed hypothesis');
    expect(digest).not.toContain('Obsolete');
  });
  it('retains an unsigned intake draft when no signed note exists', async () => {
    mocks.session.mockResolvedValue({ therapyNote: null, noteDraft: { content: intake } });
    expect((await gatherInputs('client-1', 'psy-1')).intakeNote?.workingHypothesis).toBe(
      'Reviewed hypothesis',
    );
  });
});
