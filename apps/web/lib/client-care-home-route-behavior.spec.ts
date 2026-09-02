import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  shares: vi.fn(),
  assignments: vi.fn(),
}));

vi.mock('@cureocity/contracts', () => ({
  CLIENT_CARE_HOME_ORDER: [
    'WHAT_TO_DO_NEXT',
    'UPCOMING_SESSION',
    'HOMEWORK_CHECKINS',
    'GOALS_PROGRESS',
    'THERAPIST_RESOURCES',
    'HISTORY',
  ],
  PatientShareSnapshotSchema: {
    safeParse: vi.fn((snapshot) => ({ success: true, data: snapshot })),
  },
  ClientCareHomeSchema: { parse: vi.fn((value) => value) },
}));
vi.mock('./auth-server', () => ({
  resolveClient: vi.fn(async () => ({ ok: true, value: { clientId: 'client-1' } })),
}));
vi.mock('./mind-journey-flags', () => ({ mindJourneyFlagEnabledFromEnv: vi.fn(() => true) }));
vi.mock('./prisma', () => ({
  prisma: {
    client: {
      findFirst: vi.fn(async () => ({
        id: 'client-1',
        psychologistId: 'psy-1',
        psychologist: { vertical: 'THERAPIST' },
      })),
    },
    $queryRaw: vi.fn(async () => [{ id: 'legacy-share' }, { id: 'explicit-share' }]),
    patientShare: { findMany: mocks.shares },
    exerciseAssignment: { findMany: mocks.assignments },
    session: { findFirst: vi.fn(async () => null) },
  },
}));

import { GET } from '../app/api/v1/p/home/route';

describe('client care-home actionable homework', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const now = Date.now();
    mocks.shares.mockResolvedValue([
      {
        id: 'legacy-share',
        artefactType: 'THERAPY_SCRIPT',
        artefactId: 'script-1',
        subject: 'Practice',
        snapshot: { kind: 'THERAPY_SCRIPT', homeworkAssignmentId: 'assignment-legacy' },
        createdAt: new Date(now - 1000),
        shareToken: 'legacy-token',
        expiresAt: new Date(now + 60_000),
        status: 'SENT',
      },
      {
        id: 'explicit-share',
        artefactType: 'HOMEWORK',
        artefactId: 'assignment-expired',
        subject: 'Homework',
        snapshot: { kind: 'HOMEWORK', assignmentId: 'assignment-expired', task: 'Breathe' },
        createdAt: new Date(now - 2000),
        shareToken: 'expired-token',
        expiresAt: new Date(now - 1000),
        status: 'SENT',
      },
    ]);
    mocks.assignments.mockResolvedValue([
      {
        id: 'assignment-legacy',
        customDescription: 'Legacy task',
        exerciseId: null,
        frequency: null,
        therapistNote: null,
        assignedAt: new Date(now - 1000),
      },
      {
        id: 'assignment-expired',
        customDescription: 'Expired task',
        exerciseId: null,
        frequency: null,
        therapistNote: null,
        assignedAt: new Date(now - 2000),
      },
    ]);
  });

  it('links legacy THERAPY_SCRIPT homework and exposes expired explicit homework refresh path', async () => {
    const response = await GET(new Request('https://example.test/api/v1/p/home') as never);
    const body = await response.json();
    const homework = body.sections.find(
      (section: { kind: string }) => section.kind === 'HOMEWORK_CHECKINS',
    ).items;

    expect(homework).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'assignment-legacy', href: '/p/legacy-token' }),
        expect.objectContaining({
          id: 'assignment-expired',
          href: '/p/home?refresh=explicit-share',
        }),
      ]),
    );
  });
});
