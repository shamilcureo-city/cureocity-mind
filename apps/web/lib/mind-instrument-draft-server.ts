import { createHash } from 'node:crypto';
import type { MindInstrumentDraft, Prisma } from '@prisma/client';
import { INSTRUMENTS, InstrumentScoringError, scoreInstrument } from '@cureocity/clinical';
import {
  InstrumentResponseMapSchema,
  type InstrumentKey,
  type MindInstrumentDraftInput,
  type MindInstrumentDraftState,
} from '@cureocity/contracts';
import { encryptForTenant, decryptForTenant } from './tenant-crypto';
import { writeAudit } from './audit';

export class MindInstrumentDraftError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409 | 422 = 409,
  ) {
    super(message);
  }
}

export function validateDraftAnswers(
  instrumentKey: InstrumentKey,
  answers: Record<string, number>,
): void {
  const parsed = InstrumentResponseMapSchema.safeParse(answers);
  const ids = new Set(INSTRUMENTS[instrumentKey].items.map((item) => item.id));
  if (!parsed.success || Object.keys(answers).some((id) => !ids.has(id)))
    throw new MindInstrumentDraftError(
      'Answers must match this questionnaire’s curated items and response scale.',
      422,
    );
}

export function instrumentDraftRequestHash(input: MindInstrumentDraftInput): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        operation: input.operation,
        mutationId: input.mutationId,
        expectedRevision: input.expectedRevision,
        responses: input.responses
          ? Object.fromEntries(
              Object.entries(input.responses).sort(([a], [b]) => a.localeCompare(b)),
            )
          : undefined,
      }),
    )
    .digest('hex');
}

async function readAnswers(row: MindInstrumentDraft): Promise<Record<string, number>> {
  if (row.status !== 'ACTIVE') return {};
  if (!row.answersEncrypted)
    throw new MindInstrumentDraftError(
      'The saved questionnaire could not be recovered. No answers were replaced.',
    );
  const clear = await decryptForTenant(row.psychologistId, row.answersEncrypted);
  if (clear === null)
    throw new MindInstrumentDraftError(
      'The saved questionnaire could not be recovered. No answers were replaced.',
    );
  try {
    const answers = InstrumentResponseMapSchema.parse(JSON.parse(clear));
    validateDraftAnswers(row.instrumentKey as InstrumentKey, answers);
    return answers;
  } catch {
    throw new MindInstrumentDraftError(
      'The saved questionnaire needs review. No answers were replaced.',
    );
  }
}

export async function instrumentDraftState(
  instrumentKey: InstrumentKey,
  row: MindInstrumentDraft | null,
): Promise<MindInstrumentDraftState> {
  if (!row)
    return {
      instrumentKey,
      language: 'en',
      revision: 0,
      status: 'ACTIVE',
      responses: {},
      updatedAt: null,
      submittedResponseId: null,
      riskFlagged: false,
    };
  if (!['ACTIVE', 'SUBMITTED', 'DISCARDED'].includes(row.status))
    throw new MindInstrumentDraftError('The saved questionnaire needs review.');
  return {
    instrumentKey,
    language: 'en',
    revision: row.revision,
    status: row.status as MindInstrumentDraftState['status'],
    responses: await readAnswers(row),
    updatedAt: row.updatedAt.toISOString(),
    submittedResponseId: row.submittedResponseId,
    riskFlagged: row.status === 'SUBMITTED' && row.riskFlagged,
  };
}

/** Caller holds the active Client lock first: one revision, score and audit
 * commit together, serialized against concurrent tabs, retry and erasure. */
export async function mutateInstrumentDraft(
  tx: Prisma.TransactionClient,
  context: { clientId: string; psychologistId: string; instrumentKey: InstrumentKey },
  input: MindInstrumentDraftInput,
): Promise<MindInstrumentDraftState> {
  const { clientId, psychologistId, instrumentKey } = context;
  const key = { clientId_instrumentKey: { clientId, instrumentKey } };
  const current = await tx.mindInstrumentDraft.findUnique({ where: key });
  if (current && current.psychologistId !== psychologistId)
    throw new MindInstrumentDraftError('Client not found', 404);
  const requestHash = instrumentDraftRequestHash(input);
  if (current?.lastMutationId === input.mutationId) {
    const acknowledgedHash = current.lastMutationHash
      ? await decryptForTenant(psychologistId, current.lastMutationHash)
      : null;
    if (acknowledgedHash !== requestHash)
      throw new MindInstrumentDraftError(
        'This save receipt belongs to different answers. Reload the saved questionnaire.',
      );
    return instrumentDraftState(instrumentKey, current);
  }
  if ((current?.revision ?? 0) !== input.expectedRevision)
    throw new MindInstrumentDraftError(
      'This questionnaire changed in another tab. Reload the saved answers before continuing.',
    );
  if (input.operation === 'SUBMIT' && (!current || current.status !== 'ACTIVE'))
    throw new MindInstrumentDraftError('Save a new questionnaire before submitting it.');

  const revision = (current?.revision ?? 0) + 1;
  const lastMutationHash = await encryptForTenant(psychologistId, requestHash);
  let answersEncrypted: string | null = null;
  let submittedResponseId: string | null = null;
  let riskFlagged = false;
  let status = 'ACTIVE';
  if (input.operation === 'SAVE') {
    const answers = input.responses ?? {};
    validateDraftAnswers(instrumentKey, answers);
    answersEncrypted = await encryptForTenant(psychologistId, JSON.stringify(answers));
  } else if (input.operation === 'SUBMIT') {
    const answers = await readAnswers(current!);
    let score;
    try {
      score = scoreInstrument(INSTRUMENTS[instrumentKey], answers, 'en');
    } catch (error) {
      if (error instanceof InstrumentScoringError)
        throw new MindInstrumentDraftError(
          'Answer every item before scoring this questionnaire.',
          422,
        );
      throw error;
    }
    const response = await tx.instrumentResponse.create({
      data: {
        clientId,
        psychologistId,
        instrumentKey,
        language: 'en',
        responses: answers as Prisma.InputJsonValue,
        score: score.score,
        severity: score.severityKey,
        riskFlagged: score.riskFlagged,
        administeredAt: new Date(),
        administeredByPsychologistId: psychologistId,
        administrationMode: 'CLINICIAN',
      },
    });
    submittedResponseId = response.id;
    riskFlagged = score.riskFlagged;
    status = 'SUBMITTED';
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: psychologistId,
        action: 'INSTRUMENT_ADMINISTERED',
        targetType: 'InstrumentResponse',
        targetId: response.id,
        metadata: {
          clientId,
          instrumentKey,
          source: 'MIND_INSTRUMENT_DRAFT',
          revision,
          language: 'en',
        },
      },
      tx,
    );
  } else {
    status = 'DISCARDED';
  }

  const data = {
    psychologistId,
    answersEncrypted,
    revision,
    status,
    lastMutationId: input.mutationId,
    lastMutationHash,
    submittedResponseId,
    riskFlagged,
  };
  const saved = await tx.mindInstrumentDraft.upsert({
    where: key,
    create: { clientId, instrumentKey, ...data },
    update: data,
  });
  const metadata = { clientId, instrumentKey, revision, mutationId: input.mutationId };
  if (input.operation === 'SAVE') {
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: psychologistId,
        action: 'MIND_INSTRUMENT_DRAFT_SAVED',
        targetType: 'MindInstrumentDraft',
        targetId: clientId,
        metadata,
      },
      tx,
    );
  } else if (input.operation === 'DISCARD') {
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: psychologistId,
        action: 'MIND_INSTRUMENT_DRAFT_DISCARDED',
        targetType: 'MindInstrumentDraft',
        targetId: clientId,
        metadata,
      },
      tx,
    );
  }
  return instrumentDraftState(instrumentKey, saved);
}
