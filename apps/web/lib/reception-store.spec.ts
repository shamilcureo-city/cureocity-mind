import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  transaction: vi.fn(),
  raw: vi.fn(),
  owner: vi.fn(),
  settings: vi.fn(),
  publicDesk: vi.fn(),
  find: vi.fn(),
  requests: vi.fn(),
  requestCount: vi.fn(),
  unique: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  read: vi.fn(),
  remove: vi.fn(),
  event: vi.fn(),
  client: vi.fn(),
  clients: vi.fn(),
  session: vi.fn(),
  appointment: vi.fn(),
  template: vi.fn(),
  encrypt: vi.fn(),
  decrypt: vi.fn(),
  lock: vi.fn(),
  clientLock: vi.fn(),
  busy: vi.fn(),
  entitlement: vi.fn(),
  billing: vi.fn(),
  defaults: vi.fn(),
  episodeFind: vi.fn(),
  episodeCreate: vi.fn(),
  audit: vi.fn(),
}));
const tx = {
  $queryRaw: m.raw,
  psychologist: { findFirst: m.owner },
  receptionSettings: { findUnique: m.settings, findFirst: m.publicDesk },
  receptionRequest: {
    findFirst: m.find,
    findMany: m.requests,
    count: m.requestCount,
    findUnique: m.unique,
    create: m.create,
    updateMany: m.update,
    findUniqueOrThrow: m.read,
    delete: m.remove,
  },
  receptionEvent: { create: m.event },
  client: { findFirst: m.client, findMany: m.clients },
  session: { create: m.session },
  appointment: { create: m.appointment },
  noteTemplate: { findFirst: m.template },
  treatmentEpisode: { findFirst: m.episodeFind, create: m.episodeCreate },
};
vi.mock('./prisma', () => ({
  prisma: new Proxy(
    {},
    {
      get: (_target, key) => (key === '$transaction' ? m.transaction : tx[key as keyof typeof tx]),
    },
  ),
}));
vi.mock('./tenant-crypto', () => ({ encryptForTenant: m.encrypt, decryptForTenant: m.decrypt }));
vi.mock('./phi-write-lock', () => ({ lockActiveClient: m.clientLock }));
vi.mock('./reception-calendar', () => ({
  acquireReceptionCalendarLock: m.lock,
  loadReceptionBusyIntervals: m.busy,
}));
vi.mock('./billing', () => ({ getEntitlement: m.entitlement, isBillingEnforced: m.billing }));
vi.mock('./session-defaults', () => ({ computeSessionDefaults: m.defaults }));
vi.mock('./clinic-queue', () => ({ nextClinicToken: vi.fn(async () => 7) }));
vi.mock('./audit', () => ({ writeAudit: m.audit }));
import {
  actOnReceptionRequest,
  loadPublicReception,
  loadReceptionWorkspace,
  submitReceptionRequest,
} from './reception-store';
import type { ReceptionRequestInput } from './reception';

const now = new Date('2026-10-01T06:00:00.000Z');
const startAt = new Date('2026-10-01T08:00:00.000Z');
const endAt = new Date('2026-10-01T08:30:00.000Z');
const input: ReceptionRequestInput = {
  idempotencyKey: '00000000-0000-4000-8000-000000000001',
  kind: 'BOOKING',
  patientName: 'Synthetic Person',
  patientPhone: '+971501234567',
  message: '',
  consentContact: true,
  desiredStartAt: startAt.toISOString(),
};
const settings = {
  psychologistId: 'owner-1',
  slug: 'practice',
  enabled: true,
  revision: 1,
  config: {
    practiceName: 'Practice',
    timezone: 'Asia/Dubai',
    mode: 'IN_PERSON',
    slotMinutes: 30,
    hours: [{ weekday: 4, startMinute: 720, endMinute: 780 }],
    faqs: [],
  },
  psychologist: { fullName: 'Synthetic Practitioner', vertical: 'DOCTOR' },
};
const row = () => ({
  id: 'request-1',
  psychologistId: 'owner-1',
  kind: 'BOOKING',
  status: 'NEW',
  revision: 1,
  payloadEncrypted: 'encrypted-payload',
  startAt,
  endAt,
  mode: 'IN_PERSON',
  clientId: null,
  sessionId: null,
  appointmentId: null,
  createdAt: now,
  updatedAt: now,
  events: [],
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.stubEnv('RECEPTION_RATE_LIMIT_SECRET', 'synthetic-test-key-at-least-thirty-two-characters');
  m.transaction.mockImplementation((work) => work(tx));
  m.raw.mockResolvedValue([{ ready: true }]);
  m.owner.mockResolvedValue({
    id: 'owner-1',
    fullName: 'Synthetic Practitioner',
    vertical: 'DOCTOR',
  });
  m.settings.mockResolvedValue(settings);
  m.publicDesk.mockResolvedValue(settings);
  m.find.mockResolvedValue(row());
  m.requests.mockResolvedValue([]);
  m.requestCount.mockResolvedValue(0);
  m.clients.mockResolvedValue([]);
  m.unique.mockResolvedValue(null);
  m.create.mockResolvedValue(row());
  m.update.mockResolvedValue({ count: 1 });
  m.read.mockResolvedValue({
    ...row(),
    status: 'BOOKED',
    clientId: 'client-1',
    sessionId: 'session-1',
    appointmentId: 'appointment-1',
  });
  m.client.mockResolvedValue({
    id: 'client-1',
    fullNameEncrypted: 'owned-name',
    contactPhoneEncrypted: 'owned-phone',
    contactEmailEncrypted: null,
  });
  m.session.mockResolvedValue({ id: 'session-1' });
  m.appointment.mockResolvedValue({ id: 'appointment-1' });
  m.encrypt.mockResolvedValue('encrypted-payload');
  m.decrypt.mockResolvedValue(JSON.stringify(input));
  m.busy.mockResolvedValue([]);
  m.billing.mockReturnValue(false);
  m.defaults.mockResolvedValue({
    kind: 'INTAKE',
    modality: 'INTAKE',
    language: 'en',
    spokenLanguages: [],
  });
  m.episodeFind.mockResolvedValue(null);
  m.episodeCreate.mockResolvedValue({ id: 'episode-1' });
});

describe('bounded reception inbox loading', () => {
  function seedRequests(rows: ReturnType<typeof row>[]) {
    type Where = { psychologistId: string; status?: string | { not: string } };
    const matches = (record: ReturnType<typeof row>, where: Where) =>
      record.psychologistId === where.psychologistId &&
      (typeof where.status === 'string'
        ? record.status === where.status
        : where.status
          ? record.status !== where.status.not
          : true);
    m.requests.mockImplementation(
      ({
        where,
        orderBy,
        take,
      }: {
        where: Where;
        orderBy: { createdAt?: string } | Array<{ createdAt?: string; id?: string }>;
        take: number;
      }) => {
        const direction = (Array.isArray(orderBy) ? orderBy[0] : orderBy)?.createdAt;
        return Promise.resolve(
          rows
            .filter((record) => matches(record, where))
            .sort((a, b) => {
              const difference =
                a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);
              return direction === 'asc' ? difference : -difference;
            })
            .slice(0, take),
        );
      },
    );
    m.requestCount.mockImplementation(({ where }: { where: Where }) =>
      Promise.resolve(rows.filter((record) => matches(record, where)).length),
    );
  }

  it('keeps an old pending request visible despite more than 200 newer completed requests', async () => {
    const closed = Array.from({ length: 250 }, (_, index) => ({
      ...row(),
      id: `closed-${String(index).padStart(3, '0')}`,
      status: 'RESOLVED',
      createdAt: new Date(now.getTime() + index * 60_000),
    }));
    seedRequests([
      ...closed,
      { ...row(), id: 'old-pending', createdAt: new Date('2026-09-01T00:00:00Z') },
    ]);

    const workspace = await loadReceptionWorkspace('owner-1');
    expect(workspace.pendingCount).toBe(1);
    expect(workspace.hasMoreHistory).toBe(true);
    expect(workspace.requests).toHaveLength(201);
    expect(workspace.requests[0]).toMatchObject({ id: 'old-pending', status: 'NEW' });
    expect(workspace.requests[1].id).toBe('closed-249');
    expect(workspace.requests.at(-1)?.id).toBe('closed-050');
    expect(workspace.requests.some((item) => item.id === 'closed-049')).toBe(false);
    // The 201st history row is only a truncation sentinel, not decrypted or returned.
    expect(m.decrypt).toHaveBeenCalledTimes(201);
    expect(m.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
      timeout: 15_000,
    });
  });

  it('returns the oldest 200 pending in stable order and counts every owned pending request', async () => {
    const pending = Array.from({ length: 205 }, (_, index) => ({
      ...row(),
      id: `pending-${String(index).padStart(3, '0')}`,
      // Pairs share a timestamp to exercise the id tie-breaker.
      createdAt: new Date(now.getTime() + Math.floor(index / 2) * 60_000),
    }));
    seedRequests([
      ...pending.reverse(),
      { ...row(), id: 'another-owner', psychologistId: 'owner-2', createdAt: new Date(0) },
      { ...row(), id: 'booked', status: 'BOOKED' },
    ]);

    const workspace = await loadReceptionWorkspace('owner-1');
    expect(workspace.pendingCount).toBe(205);
    expect(workspace.hasMoreHistory).toBe(false);
    expect(
      workspace.requests.filter((item) => item.status === 'NEW').map((item) => item.id),
    ).toEqual(
      Array.from({ length: 200 }, (_, index) => `pending-${String(index).padStart(3, '0')}`),
    );
    expect(workspace.requests).toHaveLength(201);
    expect(workspace.requests.at(-1)?.id).toBe('booked');
    expect(workspace.requests.some((item) => item.id === 'another-owner')).toBe(false);
    expect(m.requests).toHaveBeenCalledWith({
      where: { psychologistId: 'owner-1', status: 'NEW' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 200,
      include: { events: { orderBy: { createdAt: 'asc' } } },
    });
    expect(m.requests).toHaveBeenCalledWith({
      where: { psychologistId: 'owner-1', status: { not: 'NEW' } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 201,
      include: { events: { orderBy: { createdAt: 'asc' } } },
    });
    expect(m.requestCount).toHaveBeenCalledWith({
      where: { psychologistId: 'owner-1', status: 'NEW' },
    });
  });

  it('does not report truncated history when exactly 200 completed requests exist', async () => {
    seedRequests(
      Array.from({ length: 200 }, (_, index) => ({
        ...row(),
        id: `done-${index}`,
        status: 'DECLINED',
      })),
    );
    const workspace = await loadReceptionWorkspace('owner-1');
    expect(workspace.pendingCount).toBe(0);
    expect(workspace.hasMoreHistory).toBe(false);
    expect(workspace.requests).toHaveLength(200);
  });
});

describe('reception persistence boundaries', () => {
  it('retries a rolled-back PostgreSQL deadlock before persisting the request once', async () => {
    m.transaction.mockRejectedValueOnce({ code: 'P2010', meta: { code: '40P01' } });
    await submitReceptionRequest('practice', input);
    expect(m.transaction).toHaveBeenCalledTimes(2);
    expect(m.create).toHaveBeenCalledTimes(1);
    expect(m.event).toHaveBeenCalledTimes(1);
  });

  it('maintains Mind open-episode lifecycle and standard creation audits atomically with approval', async () => {
    m.owner.mockResolvedValue({
      id: 'owner-1',
      fullName: 'Synthetic Practitioner',
      vertical: 'THERAPIST',
    });
    await actOnReceptionRequest('owner-1', 'request-1', {
      action: 'APPROVE_BOOKING',
      clientId: 'client-1',
      identityVerified: true,
    });
    expect(m.episodeCreate).toHaveBeenCalledWith({
      data: { clientId: 'client-1', psychologistId: 'owner-1', status: 'OPEN' },
    });
    expect(m.audit.mock.calls.map(([entry]) => entry.action)).toEqual([
      'SESSION_CREATED',
      'APPOINTMENT_CONFIRMED',
      'TREATMENT_EPISODE_OPENED',
    ]);
    for (const call of m.audit.mock.calls) expect(call[1]).toBe(tx);
  });

  it('persists a public enquiry encrypted with a durable event and creates no appointment or session', async () => {
    const receipt = await submitReceptionRequest('practice', input);
    expect(receipt).toEqual({ requestId: 'request-1', status: 'NEW' });
    expect(m.create.mock.calls[0]?.[0].data).toMatchObject({
      psychologistId: 'owner-1',
      payloadEncrypted: 'encrypted-payload',
      submissionId: input.idempotencyKey,
    });
    expect(JSON.stringify(m.create.mock.calls)).not.toContain(input.patientPhone);
    expect(m.event).toHaveBeenCalledWith({
      data: { psychologistId: 'owner-1', requestId: 'request-1', kind: 'RECEIVED' },
    });
    expect(m.appointment).not.toHaveBeenCalled();
    expect(m.session).not.toHaveBeenCalled();
    expect(m.lock).toHaveBeenCalledBefore(m.create);
  });

  it('public submission replay reveals no review or chart linkage and rejects changed content', async () => {
    await submitReceptionRequest('practice', input);
    const stored = m.create.mock.calls[0]?.[0].data;
    m.unique.mockResolvedValue({
      ...row(),
      ...stored,
      status: 'BOOKED',
      clientId: 'client-1',
      sessionId: 'session-1',
    });
    m.create.mockClear();
    expect(await submitReceptionRequest('practice', input)).toEqual({
      requestId: 'request-1',
      status: 'NEW',
    });
    expect(m.create).not.toHaveBeenCalled();
    await expect(
      submitReceptionRequest('practice', { ...input, message: 'Different request' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('only exposes public allowlisted fields', async () => {
    const published = await loadPublicReception('practice');
    expect(Object.keys(published).sort()).toEqual(
      [
        'practiceName',
        'practitionerName',
        'vertical',
        'slug',
        'timezone',
        'mode',
        'slotMinutes',
        'faqs',
        'slots',
      ].sort(),
    );
    expect(m.publicDesk.mock.calls[0]?.[0].where.psychologist).toEqual({
      deletedAt: null,
      status: 'ACTIVE',
      onboardingCompletedAt: { not: null },
    });
  });

  it('approves only an explicitly selected owned active patient and records a confirmed silent booking', async () => {
    await actOnReceptionRequest('owner-1', 'request-1', {
      action: 'APPROVE_BOOKING',
      clientId: 'client-1',
      identityVerified: true,
    });
    expect(m.client.mock.calls[0]?.[0].where).toEqual({
      id: 'client-1',
      psychologistId: 'owner-1',
      deletedAt: null,
      isDemo: false,
      status: 'ACTIVE',
    });
    expect(m.lock).toHaveBeenCalledBefore(m.clientLock);
    expect(m.defaults).toHaveBeenCalledWith('client-1', 'owner-1', tx);
    expect(m.session.mock.calls[0]?.[0].data).toMatchObject({
      status: 'SCHEDULED',
      clientId: 'client-1',
    });
    expect(m.appointment.mock.calls[0]?.[0].data).toMatchObject({
      status: 'CONFIRMED',
      suppressAutomaticMessages: true,
      patientNameEncrypted: 'owned-name',
      patientPhoneEncrypted: 'owned-phone',
    });
    expect(m.update.mock.calls[0]?.[0].where).toEqual({
      id: 'request-1',
      psychologistId: 'owner-1',
      status: 'NEW',
      revision: 1,
    });
    expect(m.event.mock.calls[0]?.[0].data.kind).toBe('APPROVE_BOOKING');
  });

  it('treats a matching approval retry as a read without duplicate appointment creation', async () => {
    m.find.mockResolvedValue({ ...row(), status: 'BOOKED', clientId: 'client-1' });
    await actOnReceptionRequest('owner-1', 'request-1', {
      action: 'APPROVE_BOOKING',
      clientId: 'client-1',
      identityVerified: true,
    });
    expect(m.session).not.toHaveBeenCalled();
    expect(m.appointment).not.toHaveBeenCalled();
    expect(m.event).not.toHaveBeenCalled();
    await expect(
      actOnReceptionRequest('owner-1', 'request-1', {
        action: 'APPROVE_BOOKING',
        clientId: 'client-2',
        identityVerified: true,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('rechecks current slot occupation inside the scheduling transaction', async () => {
    m.busy.mockResolvedValue([{ startAt, endAt }]);
    await expect(
      actOnReceptionRequest('owner-1', 'request-1', {
        action: 'APPROVE_BOOKING',
        clientId: 'client-1',
        identityVerified: true,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(m.session).not.toHaveBeenCalled();
    expect(m.appointment).not.toHaveBeenCalled();
  });

  it('rejects archived, foreign and demo choices without creating clinical records', async () => {
    m.client.mockResolvedValue(null);
    await expect(
      actOnReceptionRequest('owner-1', 'request-1', {
        action: 'APPROVE_BOOKING',
        clientId: 'other-client',
        identityVerified: true,
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(m.session).not.toHaveBeenCalled();
  });

  it('honors consultation entitlement before calendar mutation', async () => {
    m.billing.mockReturnValue(true);
    m.entitlement.mockResolvedValue({ isPaidActive: false, trialUsed: 5, trialCap: 5 });
    await expect(
      actOnReceptionRequest('owner-1', 'request-1', {
        action: 'APPROVE_BOOKING',
        clientId: 'client-1',
        identityVerified: true,
      }),
    ).rejects.toMatchObject({ status: 402 });
    expect(m.session).not.toHaveBeenCalled();
    expect(m.entitlement).toHaveBeenCalledWith('owner-1', tx);
  });

  it('resolves nonbooking requests without changing the existing calendar', async () => {
    m.find.mockResolvedValue({ ...row(), kind: 'CANCEL' });
    await actOnReceptionRequest('owner-1', 'request-1', { action: 'RESOLVE' });
    expect(m.update.mock.calls[0]?.[0].data.status).toBe('RESOLVED');
    expect(m.session).not.toHaveBeenCalled();
    expect(m.appointment).not.toHaveBeenCalled();
  });

  it('never resolves a booking as though it had been booked', async () => {
    await expect(
      actOnReceptionRequest('owner-1', 'request-1', { action: 'RESOLVE' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(m.update).not.toHaveBeenCalled();
  });

  it('explicit erasure removes the enquiry and keeps only an unlinked minimal audit event', async () => {
    expect(
      await actOnReceptionRequest('owner-1', 'request-1', { action: 'ERASE', confirmErase: true }),
    ).toEqual({ erased: true });
    expect(m.remove).toHaveBeenCalledWith({ where: { id: 'request-1' } });
    expect(m.event).toHaveBeenCalledWith({
      data: { psychologistId: 'owner-1', kind: 'REQUEST_ERASED' },
    });
    expect(m.session).not.toHaveBeenCalled();
    expect(m.appointment).not.toHaveBeenCalled();
  });
});
