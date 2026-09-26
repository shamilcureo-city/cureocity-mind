import { GoogleGenAI, type Part } from '@google/genai';
import { Prisma } from '@prisma/client';
import { estimateVertexUsageCostInr, FLASH_PRICING } from '@cureocity/llm';
import { ensureGcpCreds } from './llm';
import { prisma } from './prisma';
import { ScribeDocumentError } from './scribe-document-errors';
import { checkMonthlyCostCircuit } from './cost-guard';
import { lockActiveClient } from './phi-write-lock';
import { ConsentAuthorizationError } from './consent-gate';
import { assertScribeTeleconsultRetainedAiConsent } from './scribe-teleconsult';

export type DocumentAiScope = {
  psychologistId: string;
  clientId: string;
  operation: 'report-extraction' | 'instruction-translation';
  /** Required at runtime for translations derived from a signed encounter. */
  sessionId?: string;
};

/** Uses only the configured, consented Vertex pipeline. No mock clinical results. */
export function documentAiConfig() {
  const project = process.env['VERTEX_PROJECT_ID'];
  const region = process.env['VERTEX_FLASH_REGION'] ?? 'asia-south1';
  if (process.env['LLM_BACKEND'] !== 'vertex' || !project || !region) {
    throw new ScribeDocumentError(
      503,
      'Document processing is not configured. Nothing has been extracted or translated.',
    );
  }
  return { project, region, model: process.env['VERTEX_FLASH_MODEL'] ?? 'gemini-2.5-flash' };
}

/** Recheck before network disclosure AND within the persistence lifecycle lock. */
export async function assertDocumentConsent(
  psychologistId: string,
  clientId: string,
  db: Pick<Prisma.TransactionClient, 'client' | 'consent'> = prisma,
) {
  const client = await db.client.findFirst({
    where: { id: clientId, psychologistId, deletedAt: null, status: 'ACTIVE' },
    select: { id: true },
  });
  if (!client) throw new ScribeDocumentError(404, 'Patient not found or inactive.');
  // Conservatively retain both processing consents used by Scribe, even if the configured region is India.
  const scopes = ['AI_NOTE_GENERATION', 'CROSS_BORDER_PROCESSING'] as const;
  const rows = await db.consent.findMany({
    where: {
      clientId,
      psychologistId,
      scope: { in: [...scopes] },
      status: 'GRANTED',
      withdrawnAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { scope: true },
  });
  if (scopes.some((scope) => !rows.some((row) => row.scope === scope))) {
    throw new ScribeDocumentError(
      409,
      'Current AI and processing consent is required before document processing.',
    );
  }
}

/** Encounter-specific opt-out remains authoritative after a note has been signed. */
export async function assertInstructionTranslationConsent(
  psychologistId: string,
  clientId: string,
  sessionId: string,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const check = async (db: Prisma.TransactionClient) => {
    await lockActiveClient(db, clientId, psychologistId);
    await assertDocumentConsent(psychologistId, clientId, db);
    const session = await db.session.findFirst({
      where: {
        id: sessionId,
        clientId,
        psychologistId,
        status: 'COMPLETED',
        psychologist: { vertical: 'DOCTOR', status: 'ACTIVE', deletedAt: null },
      },
      select: { id: true },
    });
    if (!session)
      throw new ScribeDocumentError(
        409,
        'The source encounter is no longer available for translation.',
      );
    try {
      await assertScribeTeleconsultRetainedAiConsent(db, sessionId, psychologistId, false);
    } catch (error) {
      if (error instanceof ConsentAuthorizationError)
        throw new ScribeDocumentError(
          409,
          'AI translation is not authorized for this consultation. Use the signed source wording instead.',
        );
      throw error;
    }
  };
  if (tx) await check(tx);
  else await prisma.$transaction(check);
}

export async function generateDocumentJson(
  systemInstruction: string,
  parts: Part[],
  scope: DocumentAiScope,
): Promise<unknown> {
  if (scope.operation === 'instruction-translation' && !scope.sessionId)
    throw new ScribeDocumentError(400, 'A source encounter is required for AI translation.');
  const config = documentAiConfig();
  ensureGcpCreds();
  const estimate = estimateVertexUsageCostInr({
    model: config.model,
    fallbackInputTokens: 50_000,
    fallbackOutputTokens: 12_000,
    fallbackPricing: FLASH_PRICING,
  });
  if (!estimate.pricingKnown)
    throw new ScribeDocumentError(
      503,
      'Document processing is unavailable for the configured model. No content was sent.',
    );
  const estimatedCostInr = estimate.costInr;
  await checkMonthlyCostCircuit({ psychologistId: scope.psychologistId, estimatedCostInr });
  const started = Date.now();
  // Reserve a bounded, tenant-attributed attempt before disclosure; concurrent requests
  // cannot evade the limit. Failed/time-out attempts retain a conservative cost estimate.
  const attempt = await prisma.$transaction(async (tx) => {
    await lockActiveClient(tx, scope.clientId, scope.psychologistId);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`scribe-document-ai:${scope.psychologistId}`}))`;
    await assertDocumentConsent(scope.psychologistId, scope.clientId, tx);
    if (scope.operation === 'instruction-translation')
      await assertInstructionTranslationConsent(
        scope.psychologistId,
        scope.clientId,
        scope.sessionId!,
        tx,
      );
    const count = await tx.geminiCallLog.count({
      where: {
        psychologistId: scope.psychologistId,
        promptVersion: { startsWith: 'scribe-document-' },
        createdAt: { gt: new Date(Date.now() - 60_000) },
      },
    });
    if (count >= 10)
      throw new ScribeDocumentError(
        429,
        'Too many document requests. Wait a minute before trying again.',
      );
    return tx.geminiCallLog.create({
      data: {
        psychologistId: scope.psychologistId,
        pass: 'ASSISTANT_CHAT',
        model: config.model,
        region: config.region,
        promptVersion: `scribe-document-${scope.operation}-v1`,
        inputTokens: 50_000,
        outputTokens: 12_000,
        costInr: new Prisma.Decimal(estimatedCostInr),
        latencyMs: 0,
        status: 'ERROR',
        errorMessage: 'Document attempt reserved; provider completion not yet acknowledged',
      },
    });
  });
  // The reservation may have waited on rate-limit/storage work. Refresh authority
  // immediately before provider disclosure, not just at the earlier route check.
  if (scope.operation === 'instruction-translation')
    await assertInstructionTranslationConsent(
      scope.psychologistId,
      scope.clientId,
      scope.sessionId!,
    );
  try {
    const ai = new GoogleGenAI({
      vertexai: true,
      project: config.project,
      location: config.region,
    });
    const response = await ai.models.generateContent({
      model: config.model,
      contents: [{ role: 'user', parts }],
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        temperature: 0,
        maxOutputTokens: 12000,
        abortSignal: AbortSignal.timeout(60_000),
      },
    });
    const cost = estimateVertexUsageCostInr({
      model: config.model,
      usage: response.usageMetadata,
      fallbackInputTokens: 50_000,
      fallbackOutputTokens: 12_000,
      fallbackPricing: FLASH_PRICING,
    });
    await prisma.geminiCallLog.updateMany({
      where: { id: attempt.id, psychologistId: scope.psychologistId },
      data: {
        inputTokens: cost.inputTokens,
        outputTokens: cost.outputTokens,
        costInr: new Prisma.Decimal(cost.costInr),
        latencyMs: Date.now() - started,
        status: 'SUCCESS',
        errorMessage: null,
      },
    });
    if (!response.text || response.text.length > 180_000) throw new Error('invalid response');
    return JSON.parse(response.text) as unknown;
  } catch {
    // Provider errors can contain request content: never log or forward them.
    throw new ScribeDocumentError(
      503,
      'Document processing did not complete. No clinical result was saved. Retry or review manually.',
    );
  }
}
