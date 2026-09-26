import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  constructor: vi.fn(),
  ensure: vi.fn(),
  client: vi.fn(),
  consent: vi.fn(),
  session: vi.fn(),
  retainedConsent: vi.fn(),
  transaction: vi.fn(),
  count: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  lock: vi.fn(),
  query: vi.fn(),
  cost: vi.fn(),
}));
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    constructor(config: unknown) {
      mocks.constructor(config);
    }
    models = { generateContent: mocks.generate };
  },
}));
vi.mock('./llm', () => ({ ensureGcpCreds: mocks.ensure }));
vi.mock('./auth-server', () => ({ requireCapability: vi.fn() }));
vi.mock('./cost-guard', () => ({ checkMonthlyCostCircuit: mocks.cost }));
vi.mock('./scribe-teleconsult', () => ({
  assertScribeTeleconsultRetainedAiConsent: mocks.retainedConsent,
}));
vi.mock('./phi-write-lock', () => ({
  lockActiveClient: mocks.lock,
  ClientPhiWriteForbiddenError: class extends Error {},
}));
vi.mock('./prisma', () => ({
  prisma: {
    client: { findFirst: mocks.client },
    consent: { findMany: mocks.consent },
    $transaction: mocks.transaction,
    geminiCallLog: { updateMany: mocks.update },
  },
}));
import {
  assertDocumentConsent,
  assertInstructionTranslationConsent,
  documentAiConfig,
  generateDocumentJson,
} from './scribe-document-ai';
import { ConsentAuthorizationError } from './consent-gate';

const scope = {
  psychologistId: 'doctor-fictional',
  clientId: 'client-fictional',
  operation: 'report-extraction' as const,
};
const tx = {
  client: { findFirst: mocks.client },
  session: { findFirst: mocks.session },
  consent: { findMany: mocks.consent },
  geminiCallLog: { count: mocks.count, create: mocks.create },
  $queryRaw: mocks.query,
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('LLM_BACKEND', 'vertex');
  vi.stubEnv('VERTEX_PROJECT_ID', 'fictional-configured-project');
  vi.stubEnv('VERTEX_FLASH_REGION', 'asia-south1');
  vi.stubEnv('VERTEX_FLASH_MODEL', 'gemini-2.5-flash');
  mocks.client.mockResolvedValue({ id: scope.clientId });
  mocks.session.mockResolvedValue({ id: 'encounter-fictional' });
  mocks.consent.mockResolvedValue([
    { scope: 'AI_NOTE_GENERATION' },
    { scope: 'CROSS_BORDER_PROCESSING' },
  ]);
  mocks.transaction.mockImplementation((run) => run(tx));
  mocks.count.mockResolvedValue(0);
  mocks.create.mockResolvedValue({ id: 'attempt-fictional' });
  mocks.generate.mockResolvedValue({
    text: '{"candidates":[]}',
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, thoughtsTokenCount: 5 },
  });
});
afterEach(() => vi.unstubAllEnvs());

describe('document AI authority, residency and bounded metering', () => {
  it('fails closed for mock/unconfigured processing without fabricated extraction', async () => {
    vi.stubEnv('LLM_BACKEND', 'mock');
    expect(() => documentAiConfig()).toThrow('not configured');
    await expect(
      generateDocumentJson('extract', [{ text: 'fictional' }], scope),
    ).rejects.toMatchObject({ status: 503 });
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it('enforces active owned patient plus current unexpired processing grants', async () => {
    await assertDocumentConsent(scope.psychologistId, scope.clientId);
    expect(mocks.client).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: scope.clientId,
          psychologistId: scope.psychologistId,
          deletedAt: null,
          status: 'ACTIVE',
        },
      }),
    );
    expect(mocks.consent).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'GRANTED',
          withdrawnAt: null,
          OR: expect.any(Array),
        }),
      }),
    );
    mocks.consent.mockResolvedValueOnce([{ scope: 'AI_NOTE_GENERATION' }]);
    await expect(assertDocumentConsent(scope.psychologistId, scope.clientId)).rejects.toMatchObject(
      { status: 409 },
    );
    mocks.client.mockResolvedValueOnce(null);
    await expect(assertDocumentConsent(scope.psychologistId, scope.clientId)).rejects.toMatchObject(
      { status: 404 },
    );
  });
  it('uses configured Vertex region, consent guard, a cost reservation, and bounded model settings', async () => {
    await generateDocumentJson(
      'safe extraction instructions',
      [{ text: 'fictional input' }],
      scope,
    );
    expect(mocks.constructor).toHaveBeenCalledWith({
      vertexai: true,
      project: 'fictional-configured-project',
      location: 'asia-south1',
    });
    expect(mocks.cost).toHaveBeenCalledOnce();
    expect(mocks.lock).toHaveBeenCalledWith(tx, scope.clientId, scope.psychologistId);
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          psychologistId: scope.psychologistId,
          pass: 'ASSISTANT_CHAT',
          promptVersion: 'scribe-document-report-extraction-v1',
        }),
      }),
    );
    expect(mocks.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          maxOutputTokens: 12000,
          temperature: 0,
          responseMimeType: 'application/json',
          abortSignal: expect.any(AbortSignal),
        }),
      }),
    );
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          inputTokens: 10,
          outputTokens: 25,
          status: 'SUCCESS',
          errorMessage: null,
        }),
      }),
    );
  });
  it('rate-limits before external disclosure and before a new reservation', async () => {
    mocks.count.mockResolvedValue(10);
    await expect(
      generateDocumentJson('extract', [{ text: 'fictional input' }], scope),
    ).rejects.toMatchObject({ status: 429 });
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('rechecks consent within the reserve transaction, before disclosure', async () => {
    mocks.consent.mockResolvedValue([]);
    await expect(
      generateDocumentJson('extract', [{ text: 'fictional input' }], scope),
    ).rejects.toMatchObject({ status: 409 });
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it('requires encounter identity for instruction translation before provider or reservation', async () => {
    await expect(
      generateDocumentJson('translate', [{ text: 'fictional' }], {
        ...scope,
        operation: 'instruction-translation',
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it('binds translation authority to an active doctor-owned completed patient encounter', async () => {
    await assertInstructionTranslationConsent(
      scope.psychologistId,
      scope.clientId,
      'encounter-fictional',
    );
    expect(mocks.session).toHaveBeenCalledWith({
      where: {
        id: 'encounter-fictional',
        clientId: scope.clientId,
        psychologistId: scope.psychologistId,
        status: 'COMPLETED',
        psychologist: { vertical: 'DOCTOR', status: 'ACTIVE', deletedAt: null },
      },
      select: { id: true },
    });
    expect(mocks.retainedConsent).toHaveBeenCalledWith(
      tx,
      'encounter-fictional',
      scope.psychologistId,
      false,
    );
    mocks.session.mockResolvedValueOnce(null);
    await expect(
      assertInstructionTranslationConsent(scope.psychologistId, scope.clientId, 'other-encounter'),
    ).rejects.toMatchObject({ status: 409 });
    expect(mocks.retainedConsent).toHaveBeenCalledTimes(1);
  });
  it('refuses a withdrawn teleconsult even when standing client grants remain valid', async () => {
    mocks.retainedConsent.mockRejectedValue(new ConsentAuthorizationError('Opted out.'));
    await expect(
      generateDocumentJson('translate', [{ text: 'fictional' }], {
        ...scope,
        operation: 'instruction-translation',
        sessionId: 'encounter-fictional',
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it('rechecks a withdrawal after reservation immediately before provider disclosure', async () => {
    mocks.retainedConsent
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new ConsentAuthorizationError('Withdrawn after reservation.'));
    await expect(
      generateDocumentJson('translate', [{ text: 'fictional' }], {
        ...scope,
        operation: 'instruction-translation',
        sessionId: 'encounter-fictional',
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.retainedConsent).toHaveBeenCalledTimes(2);
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it('allows authorized translation and keeps report extraction independent of encounter consent', async () => {
    await generateDocumentJson('translate', [{ text: 'fictional' }], {
      ...scope,
      operation: 'instruction-translation',
      sessionId: 'encounter-fictional',
    });
    expect(mocks.retainedConsent).toHaveBeenCalledTimes(2);
    expect(mocks.retainedConsent.mock.invocationCallOrder[1]).toBeLessThan(
      mocks.generate.mock.invocationCallOrder[0]!,
    );
    mocks.retainedConsent.mockClear();
    await generateDocumentJson('extract', [{ text: 'fictional' }], scope);
    expect(mocks.retainedConsent).not.toHaveBeenCalled();
  });
  it('never exposes provider errors or patient content and retains failed attempt accounting', async () => {
    mocks.generate.mockRejectedValue(new Error('fictional-patient-sensitive-provider-payload'));
    await expect(
      generateDocumentJson('extract', [{ text: 'fictional input' }], scope),
    ).rejects.toMatchObject({ status: 503 });
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.create.mock.calls)).not.toContain(
      'fictional-patient-sensitive-provider-payload',
    );
  });
});
