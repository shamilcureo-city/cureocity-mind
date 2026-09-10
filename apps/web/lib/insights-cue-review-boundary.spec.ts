import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  audits: vi.fn(),
  metrics: vi.fn(),
  sessions: vi.fn(),
  notes: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    auditLog: { findMany: mocks.audits },
    liveConsultMetric: { findMany: mocks.metrics },
    session: { count: mocks.sessions },
    therapyNote: { findMany: mocks.notes },
  },
}));
import { loadDoctorInsights } from './insights';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.metrics.mockResolvedValue([]);
  mocks.sessions.mockResolvedValue(0);
  mocks.notes.mockResolvedValue([]);
});

describe('legacy suggestion metrics exclude UI-only cue reviews', () => {
  it('queries only LiveSuggestion targets and does not count Mind review/Undo audit events', async () => {
    const createdAt = new Date('2026-09-09T10:00:00Z');
    const rows = [
      {
        targetType: 'LiveSuggestion',
        action: 'LIVE_SUGGESTION_SHOWN',
        metadata: { kind: 'ASK_NEXT' },
        createdAt,
      },
      {
        targetType: 'LiveSuggestion',
        action: 'LIVE_SUGGESTION_ACTED',
        metadata: { kind: 'ASK_NEXT' },
        createdAt,
      },
      {
        targetType: 'MindCueReview',
        action: 'LIVE_SUGGESTION_DISMISSED',
        metadata: { kind: 'ASK_NEXT', clinicalAssessmentRecorded: false },
        createdAt,
      },
      {
        targetType: 'MindCueReview',
        action: 'LIVE_SUGGESTION_SHOWN',
        metadata: { kind: 'ASK_NEXT', clinicalAssessmentRecorded: false },
        createdAt,
      },
    ];
    mocks.audits.mockImplementation(async ({ where }: { where: { targetType?: string } }) =>
      rows.filter((row) => !where.targetType || row.targetType === where.targetType),
    );
    const result = await loadDoctorInsights(
      'p1',
      new Date('2026-09-09T00:00:00Z'),
      new Date('2026-09-10T00:00:00Z'),
    );
    expect(mocks.audits.mock.calls[0][0].where).toMatchObject({
      actorPsychologistId: 'p1',
      targetType: 'LiveSuggestion',
    });
    expect(result.cards.find((card) => card.kind === 'ASK_NEXT')).toMatchObject({
      shown: 1,
      acted: 1,
      dismissed: 0,
      actRate: 1,
    });
  });
});
