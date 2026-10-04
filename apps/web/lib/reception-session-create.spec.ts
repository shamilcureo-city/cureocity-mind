import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultReceptionSettings } from './reception';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  client: vi.fn(),
  practitioner: vi.fn(),
  template: vi.fn(),
  transaction: vi.fn(),
  calendarLock: vi.fn(),
  clientLock: vi.fn(),
  settings: vi.fn(),
  sessions: vi.fn(),
  appointments: vi.fn(),
  create: vi.fn(),
  episode: vi.fn(),
  defaults: vi.fn(),
  token: vi.fn(),
  audit: vi.fn(),
}));

vi.mock('./auth-server', () => ({
  requirePsychologistId: mocks.auth,
  requireCapability: vi.fn(),
}));
vi.mock('./prisma', () => ({
  prisma: {
    client: { findUnique: mocks.client },
    psychologist: { findUnique: mocks.practitioner },
    noteTemplate: { findFirst: mocks.template },
    $transaction: mocks.transaction,
  },
}));
vi.mock('./billing', () => ({ isBillingEnforced: () => false }));
vi.mock('./audit', () => ({ auditMetadataFromRequest: () => ({}), writeAudit: mocks.audit }));
vi.mock('./mappers', () => ({ toSession: (row: unknown) => row }));
vi.mock('./session-defaults', () => ({
  computeSessionDefaults: mocks.defaults,
  modalityWasOverridden: () => false,
  SessionDefaultsError: class extends Error {},
}));
vi.mock('./clinic-queue', () => ({ nextClinicToken: mocks.token, istDayRange: vi.fn() }));

import { POST } from '../app/api/v1/sessions/route';

const CLIENT = 'cm00000000000000000000001';
const OWNER = 'reception-practitioner';
const NOW = new Date('2030-10-01T10:00:00.000Z');
const MINUTE = 60_000;
const tx = {
  $executeRaw: mocks.calendarLock,
  $queryRaw: mocks.clientLock,
  receptionSettings: { findUnique: mocks.settings },
  session: { findMany: mocks.sessions, create: mocks.create },
  appointment: { findMany: mocks.appointments },
  treatmentEpisode: { findFirst: mocks.episode },
};

// ClinicBoard's Add to queue / Add & start and StartEncounterButton all use
// this payload. In particular, the doctor UI does not send `startNow`.
function request(scheduledAt = NOW) {
  return POST(
    new NextRequest('https://example.test/api/v1/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: CLIENT, scheduledAt: scheduledAt.toISOString() }),
    }),
  );
}

function useVertical(vertical: 'DOCTOR' | 'THERAPIST') {
  mocks.auth.mockResolvedValue({
    ok: true,
    value: { psychologistId: OWNER, user: { vertical } },
  });
  mocks.practitioner.mockResolvedValue({ vertical });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(NOW.getTime());
  vi.stubEnv('RECEPTION_PILOT_ENABLED', 'true');
  useVertical('DOCTOR');
  mocks.client.mockResolvedValue({
    id: CLIENT,
    psychologistId: OWNER,
    deletedAt: null,
    isDemo: false,
  });
  mocks.template.mockResolvedValue(null);
  mocks.defaults.mockResolvedValue({
    kind: 'TREATMENT',
    modality: 'SUPPORTIVE',
    language: 'en',
    modalitySource: 'FALLBACK',
  });
  mocks.transaction.mockImplementation((run) => run(tx));
  mocks.calendarLock.mockResolvedValue(1);
  mocks.clientLock.mockResolvedValue([{ id: CLIENT, psychologistId: OWNER }]);
  mocks.settings.mockResolvedValue({
    enabled: true,
    slug: 'fictional-practice',
    revision: 1,
    config: {
      ...defaultReceptionSettings('Fictional practice'),
      hours: [{ weekday: 1, startMinute: 480, endMinute: 1020 }],
    },
  });
  mocks.sessions.mockResolvedValue([{ id: 'already-queued', scheduledAt: NOW }]);
  mocks.appointments.mockResolvedValue([]);
  mocks.token.mockResolvedValue(2);
  mocks.create.mockImplementation(async ({ data }) => ({ id: 'new-queue-entry', ...data }));
  mocks.episode.mockResolvedValue({ id: 'open-episode' });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('Reception-aware session creation through existing product payloads', () => {
  it('allows a doctor walk-in alongside queued sessions without starting capture', async () => {
    const response = await request();
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ status: 'SCHEDULED', tokenNumber: 2 });
    expect(mocks.sessions).not.toHaveBeenCalled();
    expect(mocks.appointments).toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.create.mock.calls[0]![0].data).not.toHaveProperty('startedAt');
    expect(mocks.create.mock.calls[0]![0].data).not.toHaveProperty('consentSnapshot');
    expect(mocks.calendarLock.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.clientLock.mock.invocationCallOrder[0]!,
    );
  });

  it.each([-5, 5])(
    'preserves the immediate doctor window at an offset of %i minutes',
    async (offset) => {
      const response = await request(new Date(NOW.getTime() + offset * MINUTE));
      expect(response.status).toBe(201);
      expect(mocks.sessions).not.toHaveBeenCalled();
      expect(mocks.appointments).toHaveBeenCalled();
    },
  );

  it.each(['REQUESTED', 'CONFIRMED'])(
    'still refuses an immediate doctor entry overlapping a %s appointment',
    async (status) => {
      mocks.appointments.mockResolvedValue([
        {
          id: 'held-appointment',
          sessionId: null,
          status,
          startAt: NOW,
          endAt: new Date(NOW.getTime() + 30 * MINUTE),
        },
      ]);
      const response = await request();
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: 'RECEPTION_CALENDAR_CONFLICT' });
      expect(mocks.create).not.toHaveBeenCalled();
      expect(mocks.token).not.toHaveBeenCalled();
      expect(mocks.audit).not.toHaveBeenCalled();
    },
  );

  it('does not exempt an immediate Mind session from conflicting sessions', async () => {
    useVertical('THERAPIST');
    const response = await request();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'RECEPTION_CALENDAR_CONFLICT' });
    expect(mocks.sessions).toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each([-6, 6, 120])(
    'does not exempt a doctor booking outside the immediate window (%i minutes)',
    async (offset) => {
      const scheduledAt = new Date(NOW.getTime() + offset * MINUTE);
      mocks.sessions.mockResolvedValue([{ id: 'existing-booking', scheduledAt }]);
      const response = await request(scheduledAt);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: 'RECEPTION_CALENDAR_CONFLICT' });
      expect(mocks.sessions).toHaveBeenCalled();
      expect(mocks.create).not.toHaveBeenCalled();
    },
  );

  it('leaves existing doctor queue creation unchanged with the deployment switch off', async () => {
    vi.stubEnv('RECEPTION_PILOT_ENABLED', 'false');
    expect((await request()).status).toBe(201);
    expect(mocks.calendarLock).not.toHaveBeenCalled();
    expect(mocks.settings).not.toHaveBeenCalled();
    expect(mocks.sessions).not.toHaveBeenCalled();
    expect(mocks.appointments).not.toHaveBeenCalled();
  });
});
