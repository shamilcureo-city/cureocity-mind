import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import {
  ScribeIntakeBodySchema,
  ScribeIntakeReportSchema,
  ScribeIntakeVitalsSchema,
  intakeVitalsText,
} from './scribe-intake-contracts';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}));
vi.mock('./auth-server', () => ({ requireCapability: mocks.auth }));
vi.mock('./scribe-workspace-store', () => ({
  listScribeRecords: mocks.list,
  getScribeRecord: mocks.get,
  createScribeRecord: mocks.create,
  updateScribeRecord: mocks.update,
}));
import {
  intakeFreshnessGuard,
  intakeTokenHash,
  intakeTokenUsable,
  newIntakeGrant,
  publicIntakeRecord,
  readIntakeSubmission,
  submittedIntake,
} from './scribe-intake';
import { ScribeWorkspaceError } from './scribe-workspace-auth';
import { GET, POST } from '../app/api/v1/clients/[id]/scribe-intake/route';
import { PATCH } from '../app/api/v1/clients/[id]/scribe-intake/[recordId]/route';
import { POST as SUBMIT } from '../app/api/v1/scribe-intake/submit/route';

const report = ScribeIntakeReportSchema.parse({
  authorName: 'Fictional helper',
  authorRole: 'staff',
  reasonForVisit: 'Fictional concern',
  allergyStatus: 'unknown',
  acknowledged: true,
});
let grant = newIntakeGrant(24);
let record = {
  id: 'record-1',
  revision: 1,
  clientId: 'patient-1',
  sessionId: null as string | null,
  createdAt: '2026-09-25T00:00:00.000Z',
  updatedAt: '2026-09-25T00:00:00.000Z',
  body: grant.body,
};
const context = { params: Promise.resolve({ id: 'patient-1' }) };
const reviewContext = { params: Promise.resolve({ id: 'patient-1', recordId: 'record-1' }) };
function request(body: unknown, method = 'POST') {
  return new NextRequest('https://example.test/api', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
function submit(overrides = {}) {
  return SUBMIT(
    request({
      psychologistId: 'doctor-1',
      recordId: record.id,
      token: grant.token,
      report,
      ...overrides,
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  grant = newIntakeGrant(24);
  record = { ...record, revision: 1, clientId: 'patient-1', sessionId: null, body: grant.body };
  mocks.auth.mockResolvedValue({
    ok: true,
    value: { psychologistId: 'doctor-1', user: { vertical: 'DOCTOR' } },
  });
  mocks.list.mockResolvedValue([record]);
  mocks.get.mockImplementation(async (scope, id) =>
    scope.psychologistId === 'doctor-1' &&
    (!scope.clientId || scope.clientId === record.clientId) &&
    id === record.id
      ? record
      : null,
  );
  mocks.create.mockImplementation(async (_scope, body) => ({ ...record, body }));
  mocks.update.mockImplementation(async (scope, _id, revision, body) => {
    if (revision !== record.revision) throw new ScribeWorkspaceError(409, 'Changed elsewhere');
    if (scope.guard)
      await scope.guard({ session: { findUnique: async () => ({ status: 'SCHEDULED' }) } });
    record = { ...record, revision: revision + 1, body };
    return record;
  });
});

describe('write-only previsit intake grants', () => {
  it('requires timestamped, bounded readings and paired blood pressure without inferring normality', () => {
    expect(ScribeIntakeVitalsSchema.safeParse({ heartRateBpm: 80 }).success).toBe(false);
    expect(ScribeIntakeVitalsSchema.safeParse({ measuredAt: '2026-09-25T00:00:00Z' }).success).toBe(
      false,
    );
    expect(
      ScribeIntakeVitalsSchema.safeParse({ measuredAt: '2026-09-25T00:00:00Z', bpSystolic: 120 })
        .success,
    ).toBe(false);
    expect(
      ScribeIntakeVitalsSchema.safeParse({ measuredAt: '2026-09-25T00:00:00Z', spo2Pct: 101 })
        .success,
    ).toBe(false);
    const vitals = ScribeIntakeVitalsSchema.parse({
      measuredAt: '2026-09-25T00:00:00Z',
      bpSystolic: 120,
      bpDiastolic: 80,
      weightKg: 70.5,
    });
    expect(intakeVitalsText(vitals)).toBe('BP 120/80 mmHg · Weight 70.5 kg');
    const submitted = submittedIntake(grant.body, { ...report, vitals });
    expect(submitted.report?.vitals).toEqual(vitals);
    expect(submitted.authorVerified).toBe(false);
    expect(submitted.review.status).toBe('pending');
  });
  it('creates an unpredictable token and stores only its hash', () => {
    expect(grant.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(grant.body.tokenHash).toBe(intakeTokenHash(grant.token));
    expect(JSON.stringify(grant.body)).not.toContain(grant.token);
    expect(intakeTokenUsable(grant.body, grant.token)).toBe(true);
    expect(intakeTokenUsable(grant.body, newIntakeGrant(24).token)).toBe(false);
  });
  it.each(['expired', 'revoked', 'used', 'reported', 'reviewed'] as const)(
    'rejects %s grants',
    (state) => {
      const body = { ...grant.body };
      if (state === 'expired') body.expiresAt = new Date(Date.now() - 1).toISOString();
      if (state === 'revoked') body.revokedAt = new Date().toISOString();
      if (state === 'used') body.submittedAt = new Date().toISOString();
      if (state === 'reported') body.report = report;
      if (state === 'reviewed') body.review = { ...body.review, status: 'reviewed' };
      expect(intakeTokenUsable(body, grant.token)).toBe(false);
    },
  );
  it('records server time, pending review and unverified author without changing grant scope', () => {
    const body = submittedIntake(grant.body, report, new Date('2026-09-25T10:00:00Z'));
    expect(body).toMatchObject({
      submittedAt: '2026-09-25T10:00:00.000Z',
      authorVerified: false,
      report,
      review: { status: 'pending', reviewedBy: null },
    });
    expect(body.tokenHash).toBe(grant.body.tokenHash);
    expect(ScribeIntakeBodySchema.safeParse(body).success).toBe(true);
    expect(publicIntakeRecord({ ...record, body }).body).not.toHaveProperty('tokenHash');
  });
  it('rejects forged verification and ambiguous allergy claims', () => {
    expect(ScribeIntakeReportSchema.safeParse({ ...report, authorVerified: true }).success).toBe(
      false,
    );
    expect(
      ScribeIntakeReportSchema.safeParse({
        ...report,
        allergyStatus: 'none_reported',
        allergies: 'penicillin',
      }).success,
    ).toBe(false);
    expect(
      ScribeIntakeReportSchema.safeParse({ ...report, allergyStatus: 'reported' }).success,
    ).toBe(false);
    expect(
      ScribeIntakeReportSchema.safeParse({ ...report, allergyStatus: 'none_reported' }).success,
    ).toBe(true);
  });
  it('bounds public requests before JSON parsing', async () => {
    await expect(
      readIntakeSubmission(
        new Request('https://example.test', { method: 'POST', body: 'x'.repeat(16001) }),
      ),
    ).rejects.toThrow();
    await expect(
      readIntakeSubmission(
        new Request('https://example.test', { method: 'POST', body: '{"a":1}' }),
      ),
    ).resolves.toEqual({ a: 1 });
  });
  it('rechecks expiry and scheduled status under transaction locks', async () => {
    const tx = {
      session: { findUnique: vi.fn().mockResolvedValue({ status: 'IN_PROGRESS' }) },
    } as unknown as Prisma.TransactionClient;
    await expect(intakeFreshnessGuard(grant.body.expiresAt, 'session-1')(tx)).rejects.toThrow(
      'closed',
    );
    await expect(intakeFreshnessGuard(new Date(Date.now() - 1).toISOString())(tx)).rejects.toThrow(
      'expired',
    );
  });
});

describe('doctor intake routes', () => {
  it('returns a fragment-only grant link and never returns its hash', async () => {
    const response = await POST(request({}), context);
    expect(response.status).toBe(201);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    const body = await response.json();
    expect(body.linkPath).toMatch(/^\/p\/scribe-intake#owner=doctor-1&record=record-1&token=/);
    expect(body.record.body).not.toHaveProperty('tokenHash');
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        psychologistId: 'doctor-1',
        clientId: 'patient-1',
        kind: 'intake',
        requireUnsigned: true,
      }),
      expect.objectContaining({ authorVerified: false }),
    );
  });
  it('lists only owner/patient-scoped records with no token hashes', async () => {
    const response = await GET(new NextRequest('https://example.test'), context);
    expect(mocks.list).toHaveBeenCalledWith(
      { psychologistId: 'doctor-1', clientId: 'patient-1', kind: 'intake' },
      ScribeIntakeBodySchema,
    );
    expect(JSON.stringify(await response.json())).not.toContain(grant.body.tokenHash);
  });
  it.each(['unauthenticated', 'therapist'])('denies %s before storage', async (state) => {
    mocks.auth.mockResolvedValue(
      state === 'unauthenticated'
        ? { ok: false, response: NextResponse.json({}, { status: 401 }) }
        : { ok: true, value: { psychologistId: 'doctor-1', user: { vertical: 'THERAPIST' } } },
    );
    expect((await POST(request({}), context)).status).toBe(state === 'unauthenticated' ? 401 : 403);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('does not review a different patient or missing submission', async () => {
    expect(
      (
        await PATCH(request({ expectedRevision: 1, action: 'reviewed' }, 'PATCH'), {
          params: Promise.resolve({ id: 'other-patient', recordId: record.id }),
        })
      ).status,
    ).toBe(404);
    expect(
      (await PATCH(request({ expectedRevision: 1, action: 'reviewed' }, 'PATCH'), reviewContext))
        .status,
    ).toBe(409);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('reviews exact revision while preserving report provenance and never applies clinical fields', async () => {
    record.body = submittedIntake(record.body, report);
    const response = await PATCH(
      request(
        { expectedRevision: 1, action: 'reviewed', note: 'Verified verbally for today' },
        'PATCH',
      ),
      reviewContext,
    );
    expect(response.status).toBe(200);
    expect(record.body.report).toEqual(report);
    expect(record.body.authorVerified).toBe(false);
    expect(record.body.review).toMatchObject({
      status: 'reviewed',
      reviewedBy: 'doctor-1',
      note: 'Verified verbally for today',
    });
    expect(mocks.update.mock.calls[0][0]).toEqual({
      psychologistId: 'doctor-1',
      kind: 'intake',
      clientId: 'patient-1',
    });
    // This route has only one staging-store mutation; no clinical store is imported or called.
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });
  it('rejects stale review revisions, and can revoke unused links', async () => {
    record.body = submittedIntake(record.body, report);
    record.revision = 2;
    expect(
      (await PATCH(request({ expectedRevision: 1, action: 'reviewed' }, 'PATCH'), reviewContext))
        .status,
    ).toBe(409);
    record.body = grant.body;
    expect(
      (await PATCH(request({ expectedRevision: 2, action: 'revoke' }, 'PATCH'), reviewContext))
        .status,
    ).toBe(200);
    expect(record.body.revokedAt).not.toBeNull();
  });
});

describe('public submission endpoint', () => {
  it('stores one unverified report with SYSTEM provenance and returns no chart data', async () => {
    const response = await submit();
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ submitted: true });
    expect(mocks.update.mock.calls[0][0]).toMatchObject({
      actorType: 'SYSTEM',
      psychologistId: 'doctor-1',
      clientId: 'patient-1',
      kind: 'intake',
      requireUnsigned: true,
    });
    expect(record.body.report).toEqual(report);
    expect(record.body.review.status).toBe('pending');
    expect(mocks.auth).not.toHaveBeenCalled();
    expect((await submit()).status).toBe(400);
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });
  it.each(['owner', 'token', 'expired', 'revoked', 'revision', 'archived', 'oversize'])(
    'rejects %s without leaking source details',
    async (state) => {
      let overrides = {};
      if (state === 'owner') overrides = { psychologistId: 'other' };
      if (state === 'token') overrides = { token: newIntakeGrant(24).token };
      if (state === 'expired') record.body.expiresAt = new Date(Date.now() - 1).toISOString();
      if (state === 'revoked') record.body.revokedAt = new Date().toISOString();
      if (state === 'revision' || state === 'archived')
        mocks.update.mockRejectedValue(new ScribeWorkspaceError(409, 'Sensitive internal detail'));
      const response =
        state === 'oversize'
          ? await SUBMIT(
              new NextRequest('https://example.test', { method: 'POST', body: 'x'.repeat(16001) }),
            )
          : await submit(overrides);
      expect(response.status).toBe(400);
      const body = JSON.stringify(await response.json());
      expect(body).not.toContain('Sensitive');
      expect(body).not.toContain(report.reasonForVisit);
      expect(body).not.toContain(grant.token);
      if (!['revision', 'archived'].includes(state)) expect(mocks.update).not.toHaveBeenCalled();
    },
  );
});
