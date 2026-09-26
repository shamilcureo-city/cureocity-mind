import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { MedicalEncounterNoteV1Schema } from '@cureocity/contracts';
import { ScribeTaskBodySchema } from './scribe-preparation-contracts';
import { newIntakeGrant, submittedIntake } from './scribe-intake';
import { ScribeIntakeReportSchema } from './scribe-intake-contracts';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  patient: vi.fn(),
  notes: vi.fn(),
  sessions: vi.fn(),
  decrypt: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}));
vi.mock('./auth-server', () => ({ requireCapability: mocks.auth }));
vi.mock('./prisma', () => ({
  prisma: {
    client: { findFirst: mocks.patient },
    therapyNote: { findMany: mocks.notes },
    session: { findMany: mocks.sessions },
  },
}));
vi.mock('./client-pii', () => ({ decryptClientField: mocks.decrypt }));
vi.mock('./scribe-workspace-store', () => ({
  listScribeRecords: mocks.list,
  getScribeRecord: mocks.get,
  createScribeRecord: mocks.create,
  updateScribeRecord: mocks.update,
}));
import {
  loadScribeBriefing,
  loadScribePendingWork,
  signedVisitSnapshot,
} from './scribe-preparation';
import { ScribeWorkspaceError } from './scribe-workspace-auth';
import { GET as BRIEFING } from '../app/api/v1/clients/[id]/scribe-briefing/route';
import { GET, POST } from '../app/api/v1/scribe-tasks/route';
import { PATCH } from '../app/api/v1/scribe-tasks/[recordId]/route';

const note = MedicalEncounterNoteV1Schema.parse({
  version: 'V1',
  chiefComplaint: 'Fictional cough',
  assessment: 'Reviewed assessment',
  plan: 'Review results',
});
const row = () => ({
  content: note,
  rxPad: {
    meds: [
      { drug: 'Fictional A', dose: 'one', durationDays: 3, status: 'confirmed' },
      { drug: 'Not prescribed', status: 'pending' },
    ],
  },
  signedAt: new Date('2026-09-25T00:00:00Z'),
  session: { id: 'session-1', scheduledAt: new Date('2026-09-24T00:00:00Z') },
});
const task = ScribeTaskBodySchema.parse({
  category: 'results',
  title: 'Review requested tests',
  dueDate: '2026-10-01',
});
const record = {
  id: 'task-1',
  revision: 2,
  clientId: 'patient-1',
  sessionId: 'session-1',
  body: task,
  createdAt: '2026-09-25T00:00:00.000Z',
  updatedAt: '2026-09-25T00:00:00.000Z',
};
function request(body: unknown, method = 'POST') {
  return new NextRequest('https://example.test/api', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({
    ok: true,
    value: { psychologistId: 'doctor-1', user: { vertical: 'DOCTOR' } },
  });
  mocks.patient.mockResolvedValue({ allergies: [] });
  mocks.notes.mockResolvedValue([row()]);
  mocks.sessions.mockResolvedValue([]);
  mocks.list.mockResolvedValue([record]);
  mocks.get.mockResolvedValue(record);
  mocks.create.mockImplementation(async (_scope, body) => ({ ...record, body }));
  mocks.update.mockImplementation(async (_scope, _id, revision, body) => {
    if (revision !== 2) throw new ScribeWorkspaceError(409, 'Changed elsewhere');
    return { ...record, revision: 3, body };
  });
  mocks.decrypt.mockResolvedValue('Fictional patient');
});

describe('doctor preparation snapshots', () => {
  it('shows the newest non-rejected intake as dated self-report rather than modifying signed history', async () => {
    const report = ScribeIntakeReportSchema.parse({
      authorName: 'Fictional staff',
      authorRole: 'staff',
      reasonForVisit: 'New fictional concern',
      allergyStatus: 'unknown',
      acknowledged: true,
      vitals: { measuredAt: '2026-09-24T00:00:00Z', heartRateBpm: 80 },
    });
    const intake = {
      ...record,
      body: submittedIntake(newIntakeGrant(24).body, report, new Date('2026-09-24T01:00:00Z')),
    };
    mocks.list.mockResolvedValue([
      {
        ...intake,
        body: {
          ...intake.body,
          submittedAt: '2026-09-25T01:00:00.000Z',
          review: { ...intake.body.review, status: 'rejected' },
        },
      },
      intake,
    ]);
    const result = await loadScribeBriefing('doctor-1', 'patient-1');
    expect(result?.intake).toEqual({
      submittedAt: '2026-09-24T01:00:00.000Z',
      reasonForVisit: 'New fictional concern',
      reviewStatus: 'pending',
      authorRole: 'staff',
      vitals: report.vitals,
    });
    expect(result?.visits[0]?.complaint).toBe('Fictional cough');
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('uses dated signed source and only confirmed prescription rows', () => {
    expect(signedVisitSnapshot(row())).toEqual({
      sessionId: 'session-1',
      encounterAt: '2026-09-24T00:00:00.000Z',
      signedAt: '2026-09-25T00:00:00.000Z',
      complaint: 'Fictional cough',
      assessment: 'Reviewed assessment',
      plan: 'Review results',
      prescriptions: [{ drug: 'Fictional A', dose: 'one', frequency: '', duration: '3 days' }],
    });
  });
  it('does not reinterpret non-medical V1 documents as a blank medical history', () => {
    expect(
      signedVisitSnapshot({
        ...row(),
        content: { version: 'V1', subjective: 'Not a medical note' },
      }),
    ).toBeNull();
  });
  it('preserves allergies unknown rather than asserting none', async () => {
    expect((await loadScribeBriefing('doctor-1', 'patient-1'))?.allergies).toEqual({
      status: 'not_recorded',
      entries: [],
    });
    mocks.patient.mockResolvedValue({ allergies: ['Penicillin'] });
    expect((await loadScribeBriefing('doctor-1', 'patient-1'))?.allergies).toEqual({
      status: 'recorded',
      entries: ['Penicillin'],
    });
  });
  it('checks patient ownership before querying locked signed history', async () => {
    await loadScribeBriefing('doctor-1', 'patient-1');
    expect(mocks.patient).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'patient-1', psychologistId: 'doctor-1', deletedAt: null },
      }),
    );
    expect(mocks.notes).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          locked: true,
          session: {
            clientId: 'patient-1',
            psychologistId: 'doctor-1',
            client: { deletedAt: null },
          },
        },
        take: 3,
      }),
    );
    mocks.notes.mockClear();
    mocks.patient.mockResolvedValue(null);
    expect(await loadScribeBriefing('doctor-1', 'other-patient')).toBeNull();
    expect(mocks.notes).not.toHaveBeenCalled();
  });
  it('returns a private briefing and refuses missing patients', async () => {
    const context = { params: Promise.resolve({ id: 'patient-1' }) };
    const response = await BRIEFING(new NextRequest('https://example.test'), context);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    mocks.patient.mockResolvedValue(null);
    expect((await BRIEFING(new NextRequest('https://example.test'), context)).status).toBe(404);
  });
  it('explicitly includes completed unsigned notes, not draft AI rows or signed charts', async () => {
    await loadScribePendingWork('doctor-1', 'patient-1');
    expect(mocks.sessions).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          psychologistId: 'doctor-1',
          clientId: 'patient-1',
          client: { deletedAt: null },
          status: 'COMPLETED',
          noteDraft: { status: 'COMPLETED' },
          OR: [{ therapyNote: null }, { therapyNote: { locked: false } }],
        },
        take: 101,
      }),
    );
  });
  it('warns when bounded task/unsigned queries cannot prove an empty inbox', async () => {
    mocks.list.mockResolvedValue(Array.from({ length: 500 }, () => record));
    mocks.sessions.mockResolvedValue(
      Array.from({ length: 101 }, (_, index) => ({
        id: `session-${index}`,
        clientId: 'patient-1',
        scheduledAt: new Date('2026-09-24T00:00:00Z'),
        client: { fullNameEncrypted: 'encrypted' },
      })),
    );
    const result = await loadScribePendingWork('doctor-1');
    expect(result).toMatchObject({ unsignedMayHaveMore: true, tasksMayHaveMore: true });
    expect(result.unsigned).toHaveLength(100);
  });
});

describe('pending-work routes and contracts', () => {
  it.each(['unauthenticated', 'therapist'])(
    'rejects %s mutations before storage',
    async (state) => {
      mocks.auth.mockResolvedValue(
        state === 'unauthenticated'
          ? { ok: false, response: NextResponse.json({}, { status: 401 }) }
          : { ok: true, value: { psychologistId: 'doctor-1', user: { vertical: 'THERAPIST' } } },
      );
      expect((await POST(request({ clientId: 'patient-1', task }))).status).toBe(
        state === 'unauthenticated' ? 401 : 403,
      );
      expect(mocks.create).not.toHaveBeenCalled();
    },
  );
  it('creates only open tasks under authenticated owner and explicit patient scope', async () => {
    const response = await POST(
      request({
        clientId: 'patient-1',
        sessionId: 'session-1',
        task: {
          category: 'referral',
          title: 'Arrange review',
          dueDate: '2026-10-01',
          assignee: 'Reception desk (label)',
        },
      }),
    );
    expect(response.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith(
      { psychologistId: 'doctor-1', kind: 'task', clientId: 'patient-1', sessionId: 'session-1' },
      expect.objectContaining({
        status: 'open',
        completionNote: '',
        assignee: 'Reception desk (label)',
      }),
    );
  });
  it('rejects invented author/assignee-account fields, finished-on-create and invalid dates', async () => {
    const base = { category: 'results', title: 'Review', dueDate: '2026-10-01' };
    for (const override of [
      { status: 'done' },
      { assigneeId: 'other-account' },
      { dueDate: '2026-02-30' },
    ]) {
      expect(
        (await POST(request({ clientId: 'patient-1', task: { ...base, ...override } }))).status,
      ).toBe(400);
    }
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('rejects client-filter access before querying work', async () => {
    mocks.patient.mockResolvedValue(null);
    expect(
      (await GET(new NextRequest('https://example.test/api?clientId=other-patient'))).status,
    ).toBe(404);
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it('updates using persisted patient/session and expected revision', async () => {
    const response = await PATCH(
      request({ expectedRevision: 2, task: { ...task, status: 'done' } }, 'PATCH'),
      { params: Promise.resolve({ recordId: record.id }) },
    );
    expect(response.status).toBe(200);
    expect(mocks.get).toHaveBeenCalledWith(
      { psychologistId: 'doctor-1', kind: 'task' },
      'task-1',
      ScribeTaskBodySchema,
    );
    expect(mocks.update).toHaveBeenCalledWith(
      { psychologistId: 'doctor-1', kind: 'task', clientId: 'patient-1', sessionId: 'session-1' },
      'task-1',
      2,
      { ...task, status: 'done' },
    );
  });
  it('returns safe stale/missing-record errors and does not accept client reparenting', async () => {
    const context = { params: Promise.resolve({ recordId: record.id }) };
    expect((await PATCH(request({ expectedRevision: 1, task }, 'PATCH'), context)).status).toBe(
      409,
    );
    expect(
      (
        await PATCH(
          request({ expectedRevision: 2, task, clientId: 'other-patient' }, 'PATCH'),
          context,
        )
      ).status,
    ).toBe(400);
    mocks.get.mockResolvedValue(null);
    expect((await PATCH(request({ expectedRevision: 2, task }, 'PATCH'), context)).status).toBe(
      404,
    );
  });
});
