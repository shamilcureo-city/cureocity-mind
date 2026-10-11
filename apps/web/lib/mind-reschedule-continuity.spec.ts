import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  owned: vi.fn(),
  transaction: vi.fn(),
  query: vi.fn(),
  audit: vi.fn(),
  calendar: vi.fn(),
  appointment: vi.fn(),
  reminders: vi.fn(),
  after: vi.fn(),
}));
vi.mock('./auth-server', () => ({ requirePsychologistId: m.auth }));
vi.mock('./audit', () => ({ auditMetadataFromRequest: () => ({}), writeAudit: m.audit }));
vi.mock('./prisma', () => ({ prisma: { $transaction: m.transaction } }));
vi.mock('./session-helpers', () => ({ fetchOwnedSession: m.owned }));
vi.mock('./mappers', () => ({ toSession: (row: unknown) => row }));
vi.mock('./appointment-email', () => ({ sendAppointmentRescheduledEmail: vi.fn() }));
vi.mock('./appointment-reminder-outbox', () => ({
  AppointmentReminderSubmissionInProgressError: class extends Error {},
  cancelAppointmentReminderDeliveriesForReschedule: m.reminders,
}));
vi.mock('./appointment-transition', () => ({ lockLinkedAppointmentForSession: m.appointment }));
vi.mock('./reception-calendar', () => ({
  lockReceptionCalendarIfEnabled: m.calendar,
  assertReceptionCalendarAvailable: vi.fn(),
  receptionCalendarConflictResponse: () => null,
  receptionSessionDurationMinutes: () => 60,
}));
vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  after: m.after,
}));
import { POST } from '../app/api/v1/sessions/[id]/reschedule/route';

const original = () => ({
  id: 'old-visit',
  clientId: 'client-1',
  psychologistId: 'psy-1',
  status: 'SCHEDULED',
  scheduledAt: new Date('2026-11-10T09:00:00Z'),
  modality: 'SUPPORTIVE',
  kind: 'TREATMENT',
  language: 'ml',
  mindPurpose: 'COUNSELLING',
  mindDocumentationMode: 'MANUAL',
  noteTemplateId: 'chosen-template',
});
type Row = ReturnType<typeof original>;
let sessions: Row[];
let followUpId: string;
let movedAppointment: { sessionId: string; startAt: Date } | null;
const save = () =>
  POST(
    new Request('https://example.test/api/v1/sessions/old-visit/reschedule', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ newScheduledAt: '2026-11-11T09:00:00Z' }),
    }) as never,
    { params: Promise.resolve({ id: 'old-visit' }) },
  );

beforeEach(() => {
  vi.resetAllMocks();
  sessions = [original()];
  followUpId = 'old-visit';
  movedAppointment = null;
  m.auth.mockResolvedValue({ ok: true, value: { psychologistId: 'psy-1' } });
  m.owned.mockImplementation(async () => structuredClone(original()));
  m.query.mockResolvedValue([{ id: 'client-1', psychologistId: 'psy-1' }]);
  m.calendar.mockResolvedValue(null);
  m.appointment.mockResolvedValue(null);
  m.transaction.mockImplementation(async (fn) => {
    const before = structuredClone(sessions);
    const beforeFollowUp = followUpId;
    try {
      return await fn({
        $queryRaw: m.query,
        session: {
          updateMany: async ({
            where,
            data,
          }: {
            where: { id: string; status: string };
            data: Partial<Row>;
          }) => {
            const found = sessions.find(
              (row) => row.id === where.id && row.status === where.status,
            );
            if (!found) return { count: 0 };
            Object.assign(found, data);
            return { count: 1 };
          },
          findUniqueOrThrow: async ({ where }: { where: { id: string } }) =>
            sessions.find((row) => row.id === where.id),
          create: async ({ data }: { data: Omit<Row, 'id'> }) => {
            const row = { id: 'new-visit', ...data };
            sessions.push(row);
            return row;
          },
        },
        mindSessionCloseoutState: {
          updateMany: async ({
            where,
            data,
          }: {
            where: {
              followUpSessionId: string;
              session: { clientId: string; psychologistId: string };
            };
            data: { followUpSessionId: string };
          }) => {
            expect(where.session).toEqual({ clientId: 'client-1', psychologistId: 'psy-1' });
            if (followUpId === where.followUpSessionId) followUpId = data.followUpSessionId;
            return { count: 1 };
          },
        },
        appointment: {
          update: async ({ data }: { data: { sessionId: string; startAt: Date } }) => {
            movedAppointment = data;
          },
        },
      });
    } catch (error) {
      sessions = before;
      followUpId = beforeFollowUp;
      throw error;
    }
  });
});

describe('Mind reschedule continuity', () => {
  it('moves the closeout receipt to the replacement and keeps explicit manual/session configuration', async () => {
    const response = await save();
    expect(response.status).toBe(201);
    expect(followUpId).toBe('new-visit');
    expect(sessions[0]!.status).toBe('RESCHEDULED');
    expect(await response.json()).toMatchObject({
      id: 'new-visit',
      status: 'SCHEDULED',
      mindPurpose: 'COUNSELLING',
      mindDocumentationMode: 'MANUAL',
      noteTemplateId: 'chosen-template',
      language: 'ml',
      scheduledAt: '2026-11-11T09:00:00.000Z',
    });
    expect(m.query.mock.invocationCallOrder[0]).toBeLessThan(
      m.appointment.mock.invocationCallOrder[0]!,
    );
  });
  it('copies the current locked row, not a configuration snapshot read before the transaction', async () => {
    sessions[0]!.mindPurpose = 'ASSESSMENT';
    sessions[0]!.kind = 'INTAKE';
    expect((await save()).status).toBe(201);
    expect(sessions[1]).toMatchObject({ mindPurpose: 'ASSESSMENT', kind: 'INTAKE' });
  });
  it('continues moving linked appointments and invalidating their old reminder schedule', async () => {
    m.appointment.mockResolvedValue({
      id: 'appt-1',
      startAt: original().scheduledAt,
      endAt: new Date('2026-11-10T10:00:00Z'),
    });
    expect((await save()).status).toBe(201);
    expect(movedAppointment).toMatchObject({
      sessionId: 'new-visit',
      startAt: new Date('2026-11-11T09:00:00Z'),
    });
    expect(m.reminders).toHaveBeenCalledWith(expect.anything(), {
      appointmentId: 'appt-1',
      scheduledStartAt: original().scheduledAt,
    });
    expect(m.after).toHaveBeenCalledOnce();
  });
  it('fails closed after ownership changes or erasure without making a replacement', async () => {
    m.query.mockResolvedValue([]);
    expect((await save()).status).toBe(404);
    expect(sessions).toHaveLength(1);
    expect(followUpId).toBe('old-visit');
  });
  it('does not move the follow-up pointer if another transition already started the session', async () => {
    sessions[0]!.status = 'IN_PROGRESS';
    expect((await save()).status).toBe(409);
    expect(sessions).toHaveLength(1);
    expect(followUpId).toBe('old-visit');
  });
  it('rolls the replacement and follow-up pointer back when a later transactional write fails', async () => {
    m.audit.mockRejectedValue(new Error('audit write failed'));
    await expect(save()).rejects.toThrow('audit write failed');
    expect(sessions).toEqual([original()]);
    expect(followUpId).toBe('old-visit');
    expect(m.after).not.toHaveBeenCalled();
  });
});
