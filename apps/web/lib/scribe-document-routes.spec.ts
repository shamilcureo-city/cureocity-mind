import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReportBodySchema } from './scribe-report-schema';
import { InstructionsBodySchema } from './scribe-instructions-schema';
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  consent: vi.fn(),
  translationConsent: vi.fn(),
  config: vi.fn(),
  readUpload: vi.fn(),
  validateFile: vi.fn(),
  extract: vi.fn(),
  source: vi.fn(),
  current: vi.fn(),
  draft: vi.fn(),
  transaction: vi.fn(),
  query: vi.fn(),
  lock: vi.fn(),
  fresh: vi.fn(),
  audit: vi.fn(),
}));
vi.mock('./auth-server', () => ({ requireCapability: mocks.auth }));
vi.mock('./scribe-workspace-store', () => ({
  listScribeRecords: mocks.list,
  getScribeRecord: mocks.get,
  createScribeRecord: mocks.create,
  updateScribeRecord: mocks.update,
  deleteScribeRecord: mocks.remove,
}));
vi.mock('./scribe-document-ai', () => ({
  assertDocumentConsent: mocks.consent,
  assertInstructionTranslationConsent: mocks.translationConsent,
  documentAiConfig: mocks.config,
}));
vi.mock('./scribe-report-processing', () => ({
  readReportUpload: mocks.readUpload,
  validateReportFile: mocks.validateFile,
  extractReport: mocks.extract,
}));
vi.mock('./scribe-instructions-source', () => ({
  readSignedInstructionSource: mocks.source,
  assertInstructionSourceCurrent: mocks.current,
  draftSignedInstructions: mocks.draft,
}));
vi.mock('./phi-write-lock', () => ({
  lockActiveClientForSession: mocks.lock,
  lockActiveClient: mocks.lock,
  ClientPhiWriteForbiddenError: class extends Error {},
}));
vi.mock('./prisma', () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock('./audit', () => ({ writeAudit: mocks.audit, auditMetadataFromRequest: () => ({}) }));
import { ScribeDocumentError } from './scribe-document-errors';
import { GET as listReports, POST as uploadReport } from '../app/api/v1/scribe/reports/route';
import { PATCH as reviewReport } from '../app/api/v1/scribe/reports/[id]/route';
import { GET as originalReport } from '../app/api/v1/scribe/reports/[id]/original/route';
import { POST as draftInstructions } from '../app/api/v1/scribe/instructions/route';
import { PATCH as reviewInstructions } from '../app/api/v1/scribe/instructions/[id]/route';
import { GET as downloadInstructions } from '../app/api/v1/scribe/instructions/[id]/text/route';

const reportBody = ReportBodySchema.parse({
  version: 1,
  status: 'candidate',
  original: {
    name: 'fictional.pdf',
    mime: 'application/pdf',
    size: 3,
    pages: 1,
    sha256: 'a'.repeat(64),
    base64: 'YWJj',
  },
  candidates: [
    {
      id: 'row-1',
      name: 'Fictional result',
      value: '3',
      unit: 'mg',
      reportDate: '',
      page: 1,
      sourceText: 'Fictional result 3 mg',
      included: true,
    },
  ],
  extractedAt: '2026-09-25T10:00:00Z',
  reviewedAt: null,
  reviewedBy: null,
});
const instructionBody = InstructionsBodySchema.parse({
  version: 1,
  status: 'draft',
  language: 'source',
  sourceHash: 'b'.repeat(64),
  noteId: 'note-1',
  signedAt: '2026-09-25T10:00:00Z',
  lines: [
    {
      id: 'medication-1',
      kind: 'medication',
      source: 'Fictional A · 5 mg',
      text: 'Fictional A · 5 mg',
    },
  ],
  clinicalReviewed: false,
  languageReviewed: false,
  reviewedAt: null,
  reviewedBy: null,
});
function record(body: unknown) {
  return {
    id: 'record-1',
    revision: 1,
    body,
    clientId: 'client-1',
    sessionId: 'session-1',
    createdAt: '2026-09-25T10:00:00Z',
    updatedAt: '2026-09-25T10:00:00Z',
  };
}
const context = { params: Promise.resolve({ id: 'record-1' }) };
function req(path: string, method = 'GET', body?: unknown) {
  return new NextRequest(`https://example.test/api/v1/scribe/${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
}
const tx = { $queryRaw: mocks.query, scribeWorkspaceRecord: { findFirst: mocks.fresh } };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({
    ok: true,
    value: { psychologistId: 'doctor-1', user: { vertical: 'DOCTOR' } },
  });
  mocks.list.mockResolvedValue([record(reportBody)]);
  mocks.get.mockResolvedValue(record(reportBody));
  mocks.validateFile.mockResolvedValue(reportBody.original);
  mocks.extract.mockResolvedValue(reportBody);
  mocks.source.mockResolvedValue({
    note: {},
    clientId: 'client-1',
    sourceHash: instructionBody.sourceHash,
  });
  mocks.draft.mockResolvedValue(instructionBody);
  mocks.create.mockImplementation(async (scope, body) => {
    await scope.guard?.(tx);
    return record(body);
  });
  mocks.update.mockImplementation(async (scope, id, revision, body) => {
    await scope.guard?.(tx);
    if (revision !== 1) throw new ScribeDocumentError(409, 'Revision changed.');
    return { ...record(body), id, revision: 2 };
  });
  mocks.transaction.mockImplementation((run) => run(tx));
  mocks.fresh.mockResolvedValue({ id: 'record-1' });
});

describe('report route safety', () => {
  it('blocks unauthenticated and non-doctor callers before processing', async () => {
    mocks.auth.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: 'Login required' }, { status: 401 }),
    });
    expect((await uploadReport(req('reports?clientId=client-1', 'POST'))).status).toBe(401);
    mocks.auth.mockResolvedValueOnce({
      ok: true,
      value: { psychologistId: 'therapist', user: { vertical: 'THERAPIST' } },
    });
    expect((await uploadReport(req('reports?clientId=client-1', 'POST'))).status).toBe(403);
    expect(mocks.extract).not.toHaveBeenCalled();
  });
  it('lists tenant-scoped metadata without returning original bytes', async () => {
    const response = await listReports(req('reports?clientId=client-1'));
    expect(mocks.list).toHaveBeenCalledWith(
      expect.objectContaining({ psychologistId: 'doctor-1', kind: 'report', clientId: 'client-1' }),
      expect.anything(),
    );
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(JSON.stringify(await response.json())).not.toContain('base64');
  });
  it('refuses missing consent before extraction', async () => {
    mocks.consent.mockRejectedValueOnce(new ScribeDocumentError(409, 'Consent required.'));
    expect((await uploadReport(req('reports?clientId=client-1', 'POST'))).status).toBe(409);
    expect(mocks.extract).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('rechecks consent under the store lifecycle lock after extraction', async () => {
    mocks.consent
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new ScribeDocumentError(409, 'Consent withdrawn.'));
    expect((await uploadReport(req('reports?clientId=client-1', 'POST'))).status).toBe(409);
    expect(mocks.extract).toHaveBeenCalledOnce();
    expect(mocks.consent).toHaveBeenLastCalledWith('doctor-1', 'client-1', tx);
  });
  it('does not let the browser mark unreviewed candidates confirmed without both acknowledgments', async () => {
    const response = await reviewReport(
      req('reports/record-1', 'PATCH', {
        revision: 1,
        candidates: reportBody.candidates,
        originalReviewed: true,
      }),
      context,
    );
    expect(response.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('preserves evidence and saves only the reviewed report, with optimistic concurrency', async () => {
    const input = {
      revision: 1,
      candidates: reportBody.candidates.map((row) => ({ ...row, value: '4' })),
      originalReviewed: true,
      patientMatched: true,
    };
    const response = await reviewReport(req('reports/record-1', 'PATCH', input), context);
    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ psychologistId: 'doctor-1', kind: 'report' }),
      'record-1',
      1,
      expect.objectContaining({
        status: 'confirmed',
        reviewedBy: 'doctor-1',
        candidates: expect.arrayContaining([
          expect.objectContaining({ value: '4', sourceText: 'Fictional result 3 mg' }),
        ]),
      }),
    );
    expect(
      (await reviewReport(req('reports/record-1', 'PATCH', { ...input, revision: 2 }), context))
        .status,
    ).toBe(409);
    expect(
      (
        await reviewReport(
          req('reports/record-1', 'PATCH', {
            ...input,
            candidates: [{ ...reportBody.candidates[0], page: 2 }],
          }),
          context,
        )
      ).status,
    ).toBe(409);
  });
  it('serves originals only from tenant-scoped encrypted records with defensive headers', async () => {
    const response = await originalReport(req('reports/record-1/original'), context);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('abc');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('content-security-policy')).toContain('sandbox');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CLIENT_VIEWED',
        metadata: { surface: 'scribe_report_original', recordId: 'record-1', revision: 1 },
      }),
      tx,
    );
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain('Fictional result');
    mocks.get.mockResolvedValueOnce(null);
    expect((await originalReport(req('reports/record-1/original'), context)).status).toBe(404);
  });
});

describe('patient instruction route safety', () => {
  beforeEach(() => mocks.get.mockResolvedValue(record(instructionBody)));
  it('requires a real signed source and checks it again within creation', async () => {
    mocks.source.mockRejectedValueOnce(new ScribeDocumentError(409, 'Unsigned.'));
    expect(
      (
        await draftInstructions(
          req('instructions', 'POST', { sessionId: 'session-1', language: 'source' }),
        )
      ).status,
    ).toBe(409);
    expect(mocks.draft).not.toHaveBeenCalled();
    mocks.current.mockRejectedValueOnce(new ScribeDocumentError(409, 'Source changed.'));
    expect(
      (
        await draftInstructions(
          req('instructions', 'POST', { sessionId: 'session-1', language: 'source' }),
        )
      ).status,
    ).toBe(409);
    expect(mocks.current).toHaveBeenCalledWith(
      'doctor-1',
      'session-1',
      'client-1',
      instructionBody.sourceHash,
      tx,
    );
  });
  it('requires processing consent only when actually translating', async () => {
    expect(
      (
        await draftInstructions(
          req('instructions', 'POST', { sessionId: 'session-1', language: 'source' }),
        )
      ).status,
    ).toBe(201);
    expect(mocks.consent).not.toHaveBeenCalled();
    expect(mocks.translationConsent).not.toHaveBeenCalled();
    mocks.translationConsent.mockRejectedValue(new ScribeDocumentError(409, 'Consent required.'));
    expect(
      (
        await draftInstructions(
          req('instructions', 'POST', { sessionId: 'session-1', language: 'ml' }),
        )
      ).status,
    ).toBe(409);
  });
  it('passes exact encounter identity to translation and rechecks it under the save lock', async () => {
    expect(
      (
        await draftInstructions(
          req('instructions', 'POST', { sessionId: 'session-1', language: 'ml' }),
        )
      ).status,
    ).toBe(201);
    expect(mocks.draft).toHaveBeenCalledWith({}, 'ml', {
      psychologistId: 'doctor-1',
      clientId: 'client-1',
      sessionId: 'session-1',
    });
    expect(mocks.translationConsent).toHaveBeenNthCalledWith(
      1,
      'doctor-1',
      'client-1',
      'session-1',
    );
    expect(mocks.translationConsent).toHaveBeenNthCalledWith(
      2,
      'doctor-1',
      'client-1',
      'session-1',
      tx,
    );
  });
  it('refuses teleconsult opt-out before drafting despite otherwise valid signed source', async () => {
    mocks.translationConsent.mockRejectedValueOnce(
      new ScribeDocumentError(409, 'AI permission withdrawn.'),
    );
    expect(
      (
        await draftInstructions(
          req('instructions', 'POST', { sessionId: 'session-1', language: 'ml' }),
        )
      ).status,
    ).toBe(409);
    expect(mocks.draft).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('refuses persistence when teleconsult consent is withdrawn while translation is running', async () => {
    mocks.translationConsent
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new ScribeDocumentError(409, 'AI permission withdrawn.'));
    expect(
      (
        await draftInstructions(
          req('instructions', 'POST', { sessionId: 'session-1', language: 'ml' }),
        )
      ).status,
    ).toBe(409);
    expect(mocks.draft).toHaveBeenCalledOnce();
    expect(mocks.translationConsent).toHaveBeenLastCalledWith(
      'doctor-1',
      'client-1',
      'session-1',
      tx,
    );
    await expect(mocks.create.mock.results[0]?.value).rejects.toMatchObject({ status: 409 });
  });
  it('keeps deterministic signed-source drafting available without AI permission', async () => {
    mocks.translationConsent.mockRejectedValue(
      new ScribeDocumentError(409, 'AI permission withdrawn.'),
    );
    expect(
      (
        await draftInstructions(
          req('instructions', 'POST', { sessionId: 'session-1', language: 'source' }),
        )
      ).status,
    ).toBe(201);
    expect(mocks.translationConsent).not.toHaveBeenCalled();
    expect(mocks.draft).toHaveBeenCalledWith({}, 'source', {
      psychologistId: 'doctor-1',
      clientId: 'client-1',
      sessionId: 'session-1',
    });
  });
  it('requires independent language review and rejects medication changes', async () => {
    expect(
      (
        await reviewInstructions(
          req('instructions/record-1', 'PATCH', {
            revision: 1,
            lines: instructionBody.lines.map(({ id, text }) => ({ id, text })),
            clinicalReviewed: true,
          }),
          context,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await reviewInstructions(
          req('instructions/record-1', 'PATCH', {
            revision: 1,
            lines: [{ id: 'medication-1', text: 'Fictional A · 50 mg' }],
            clinicalReviewed: true,
            languageReviewed: true,
          }),
          context,
        )
      ).status,
    ).toBe(409);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('cannot confirm stale instructions after an unlock or re-sign', async () => {
    mocks.current.mockRejectedValue(new ScribeDocumentError(409, 'Source changed.'));
    expect(
      (
        await reviewInstructions(
          req('instructions/record-1', 'PATCH', {
            revision: 1,
            lines: instructionBody.lines.map(({ id, text }) => ({ id, text })),
            clinicalReviewed: true,
            languageReviewed: true,
          }),
          context,
        )
      ).status,
    ).toBe(409);
  });
  it.each([
    ['OD', 'BD'],
    ['before food', 'after food'],
    ['oral', 'topical'],
  ])(
    'rejects altered medication %s both on review and when downloading older reviewed records',
    async (before, after) => {
      const body = {
        ...instructionBody,
        lines: [
          {
            id: 'medication-1',
            kind: 'medication',
            source: `Fictional A · ${before}`,
            text: `Fictional A · ${before}`,
          },
        ],
      };
      mocks.get.mockResolvedValue(record(body));
      expect(
        (
          await reviewInstructions(
            req('instructions/record-1', 'PATCH', {
              revision: 1,
              lines: [{ id: 'medication-1', text: `Fictional A · ${after}` }],
              clinicalReviewed: true,
              languageReviewed: true,
            }),
            context,
          )
        ).status,
      ).toBe(409);
      mocks.get.mockResolvedValue(
        record({
          ...body,
          status: 'reviewed',
          clinicalReviewed: true,
          languageReviewed: true,
          reviewedAt: '2026-09-25T11:00:00Z',
          reviewedBy: 'doctor-1',
          lines: [{ ...body.lines[0], text: `Fictional A · ${after}` }],
        }),
      );
      expect((await downloadInstructions(req('instructions/record-1/text'), context)).status).toBe(
        409,
      );
      expect(mocks.audit).not.toHaveBeenCalled();
    },
  );
  it('never downloads an unreviewed draft or without PATIENT_SHARING', async () => {
    expect((await downloadInstructions(req('instructions/record-1/text'), context)).status).toBe(
      409,
    );
    mocks.auth.mockImplementation(async (_req, capability) =>
      capability === 'PATIENT_SHARING'
        ? { ok: false, response: NextResponse.json({ error: 'Denied' }, { status: 403 }) }
        : { ok: true, value: { psychologistId: 'doctor-1', user: { vertical: 'DOCTOR' } } },
    );
    expect((await downloadInstructions(req('instructions/record-1/text'), context)).status).toBe(
      403,
    );
  });
  it('rechecks the source and record revision under client/session locks on explicit download', async () => {
    mocks.get.mockResolvedValue(
      record({
        ...instructionBody,
        status: 'reviewed',
        clinicalReviewed: true,
        languageReviewed: true,
        reviewedAt: '2026-09-25T11:00:00Z',
        reviewedBy: 'doctor-1',
      }),
    );
    const response = await downloadInstructions(req('instructions/record-1/text'), context);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Fictional A · 5 mg');
    expect(mocks.lock).toHaveBeenCalledWith(tx, 'session-1', 'doctor-1');
    expect(mocks.current).toHaveBeenCalledWith(
      'doctor-1',
      'session-1',
      'client-1',
      instructionBody.sourceHash,
      tx,
    );
    expect(mocks.fresh).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ revision: 1, psychologistId: 'doctor-1' }),
      }),
    );
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CLIENT_VIEWED',
        metadata: {
          surface: 'scribe_instructions_download',
          recordId: 'record-1',
          revision: 1,
          sessionId: 'session-1',
        },
      }),
      tx,
    );
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain('Fictional A');
    mocks.fresh.mockResolvedValueOnce(null);
    expect((await downloadInstructions(req('instructions/record-1/text'), context)).status).toBe(
      409,
    );
  });
});
