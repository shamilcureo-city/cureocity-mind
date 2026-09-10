import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  episode: vi.fn(),
  source: vi.fn(),
  existing: vi.fn(),
  create: vi.fn(),
  audit: vi.fn(),
}));
vi.mock('./prisma', () => ({
  prisma: {
    treatmentEpisode: { findFirst: mocks.episode },
    session: { findFirst: mocks.source },
    assessmentItem: { findMany: mocks.existing, create: mocks.create },
  },
}));
vi.mock('./audit', () => ({ writeAudit: mocks.audit }));

import { assessmentCandidateAlreadyTracked, reconcileAssessmentItems } from './assessment-items';

const candidate = {
  kind: 'ASSESSMENT_GAP' as const,
  question: 'How is sleep?',
  rationale: 'Explore context.',
  icd11Code: null,
};
const closed = {
  ...candidate,
  status: 'CLOSED',
  sourceSessionId: 'prior',
  addressedSessionId: 'resolved',
};
const args = {
  clientId: 'fictional-client',
  psychologistId: 'fictional-therapist',
  sourceSessionId: 'current',
  kind: 'INTAKE' as const,
  pass3Body: {
    version: 'V1',
    workingHypothesis: 'Explore the fictional client’s priorities.',
    formulation: 'Provisional understanding.',
    recommendedTherapies: [],
    assessmentGaps: [{ question: candidate.question, rationale: candidate.rationale }],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.episode.mockResolvedValue({ id: 'episode-current', openedAt: new Date('2026-07-01') });
  mocks.source.mockResolvedValue({
    startedAt: new Date('2026-07-15'),
    endedAt: null,
    scheduledAt: new Date('2026-07-15'),
  });
  mocks.existing.mockResolvedValue([]);
  mocks.create.mockResolvedValue({ id: 'new-item' });
  mocks.audit.mockResolvedValue(undefined);
});

describe('assessment reconciliation respects clinician resolution', () => {
  it.each(['OPEN', 'ADDRESSED', 'CLOSED'])(
    'does not regenerate an existing %s question',
    async (status) => {
      mocks.existing.mockResolvedValue([{ ...closed, status }]);
      await reconcileAssessmentItems(args);
      expect(mocks.create).not.toHaveBeenCalled();
      expect(mocks.audit).not.toHaveBeenCalled();
      expect(mocks.existing).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            clientId: args.clientId,
            psychologistId: args.psychologistId,
            episodeId: 'episode-current',
          },
        }),
      );
    },
  );

  it('normalizes trailing whitespace, case and punctuation before checking a closed item', () => {
    expect(
      assessmentCandidateAlreadyTracked(
        { ...candidate, question: '  HOW   IS SLEEP?!  ' },
        [closed],
        'current',
      ),
    ).toBe(true);
  });

  it('does not treat model rationale changes as evidence to reverse a clinical resolution', () => {
    expect(
      assessmentCandidateAlreadyTracked(
        { ...candidate, rationale: 'The model wrote a different reason.' },
        [closed],
        'current',
      ),
    ).toBe(true);
    expect(closed.status).toBe('CLOSED');
  });

  it('allows a new question or a different diagnostic target', () => {
    expect(
      assessmentCandidateAlreadyTracked(
        { ...candidate, question: 'Has sleep changed since starting the new job?' },
        [closed],
        'current',
      ),
    ).toBe(false);
    expect(
      assessmentCandidateAlreadyTracked(
        { ...candidate, kind: 'DIAGNOSTIC_CRITERION', icd11Code: '6B00' },
        [{ ...closed, kind: 'DIAGNOSTIC_CRITERION', icd11Code: '6A70' }],
        'current',
      ),
    ).toBe(false);
  });

  it('creates a new episode item without changing a prior episode resolution', async () => {
    // The scoped DB query returns no current-episode identity, even though
    // the historical episode retains a closed question with identical text.
    const historicalResolution = { ...closed, episodeId: 'previous-episode' };
    mocks.existing.mockImplementation(async ({ where }) =>
      historicalResolution.episodeId === where.episodeId ? [historicalResolution] : [],
    );
    await reconcileAssessmentItems(args);
    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        episodeId: 'episode-current',
        status: 'OPEN',
        sourceSessionId: 'current',
      }),
    });
    expect(historicalResolution.status).toBe('CLOSED');
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ASSESSMENT_ITEM_CREATED' }),
      undefined,
    );
  });

  it('does not seed a new episode from a late re-run of an older session', async () => {
    mocks.source.mockResolvedValue({
      startedAt: new Date('2026-06-01'),
      endedAt: null,
      scheduledAt: new Date('2026-06-01'),
    });
    await reconcileAssessmentItems(args);
    expect(mocks.existing).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('verifies the source session belongs to the same client and clinician', async () => {
    mocks.source.mockResolvedValue(null);
    await reconcileAssessmentItems(args);
    expect(mocks.source).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'current', clientId: args.clientId, psychologistId: args.psychologistId },
      }),
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('deduplicates repeated candidates in one model response', async () => {
    await reconcileAssessmentItems({
      ...args,
      pass3Body: {
        ...args.pass3Body,
        assessmentGaps: [args.pass3Body.assessmentGaps[0], args.pass3Body.assessmentGaps[0]],
      },
    });
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it('does not query or write on an invalid model body', async () => {
    await reconcileAssessmentItems({ ...args, pass3Body: {} });
    expect(mocks.episode).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('threads the existing transaction through both the creation and audit', async () => {
    const tx = {
      treatmentEpisode: { findFirst: mocks.episode },
      session: { findFirst: mocks.source },
      assessmentItem: { findMany: mocks.existing, create: mocks.create },
    };
    await reconcileAssessmentItems(args, tx as never);
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ASSESSMENT_ITEM_CREATED' }),
      tx,
    );
  });
});

describe('fresh safety concerns cannot be silenced by a previous closure', () => {
  it.each(['SAFETY', 'ASSESSMENT_GAP'])(
    'preserves a closed %s row and creates a fresh safety question from a new session',
    async (legacyKind) => {
      const old = { ...closed, kind: legacyKind };
      mocks.existing.mockResolvedValue([old]);
      await reconcileAssessmentItems({
        ...args,
        pass3Body: {
          ...args.pass3Body,
          assessmentGaps: [{ ...args.pass3Body.assessmentGaps[0], purpose: 'safety' }],
        },
      });
      expect(mocks.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          kind: 'SAFETY',
          status: 'OPEN',
          sourceSessionId: 'current',
        }),
      });
      expect(old.status).toBe('CLOSED');
    },
  );

  it.each(['sourceSessionId', 'addressedSessionId'])(
    'does not resurrect a safety concern on replay of the already-resolved %s',
    (field) => {
      expect(
        assessmentCandidateAlreadyTracked(
          { ...candidate, kind: 'SAFETY' },
          [{ ...closed, kind: 'SAFETY', [field]: 'current' }],
          'current',
        ),
      ).toBe(true);
    },
  );

  it('keeps an existing open safety question rather than duplicating it', () => {
    expect(
      assessmentCandidateAlreadyTracked(
        { ...candidate, kind: 'SAFETY' },
        [{ ...closed, kind: 'SAFETY', status: 'OPEN' }],
        'current',
      ),
    ).toBe(true);
  });
});
