import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MindInstrumentDraft, Prisma } from '@prisma/client';
import { MindInstrumentDraftInputSchema } from '@cureocity/contracts';

const cryptoMocks = vi.hoisted(() => ({ encrypt: vi.fn(), decrypt: vi.fn(), audit: vi.fn() }));
vi.mock('./tenant-crypto', () => ({
  encryptForTenant: cryptoMocks.encrypt,
  decryptForTenant: cryptoMocks.decrypt,
}));
vi.mock('./audit', () => ({ writeAudit: cryptoMocks.audit }));
import {
  instrumentDraftState,
  mutateInstrumentDraft,
  validateDraftAnswers,
} from './mind-instrument-draft-server';

const context = {
  clientId: 'fictional-client',
  psychologistId: 'fictional-therapist',
  instrumentKey: 'PHQ9' as const,
};
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const complete = Object.fromEntries(
  Array.from({ length: 9 }, (_, i) => [`phq9_${i + 1}`, i === 8 ? 1 : 0]),
);

function db() {
  let row: MindInstrumentDraft | null = null;
  const findUnique = vi.fn(async () => row);
  const upsert = vi.fn(async ({ create, update }) => {
    row = {
      ...(row ?? { createdAt: new Date('2026-07-01') }),
      ...(row ? update : create),
      updatedAt: new Date('2026-07-15'),
    } as MindInstrumentDraft;
    return row;
  });
  const response = vi.fn(async () => ({ id: 'scored-response' }));
  return {
    tx: {
      mindInstrumentDraft: { findUnique, upsert },
      instrumentResponse: { create: response },
    } as unknown as Prisma.TransactionClient,
    row: () => row,
    seed: (value: MindInstrumentDraft) => {
      row = value;
    },
    upsert,
    response,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  cryptoMocks.encrypt.mockImplementation(async (_tenant, clear) => `encrypted:${clear}`);
  cryptoMocks.decrypt.mockImplementation(async (_tenant, encrypted) =>
    encrypted.startsWith('encrypted:') ? encrypted.slice(10) : null,
  );
  cryptoMocks.audit.mockResolvedValue(undefined);
});

describe('encrypted questionnaire draft persistence', () => {
  it('saves partial answers encrypted without creating a score or a clinical outcome', async () => {
    const test = db();
    const receipt = await mutateInstrumentDraft(test.tx, context, {
      operation: 'SAVE',
      mutationId: uuid(1),
      expectedRevision: 0,
      responses: { phq9_1: 2 },
    });
    expect(receipt).toMatchObject({
      status: 'ACTIVE',
      revision: 1,
      responses: { phq9_1: 2 },
      submittedResponseId: null,
      riskFlagged: false,
    });
    expect(test.row()!.answersEncrypted).toBe('encrypted:{"phq9_1":2}');
    expect(test.row()!.lastMutationHash).toMatch(/^encrypted:/);
    expect(test.response).not.toHaveBeenCalled();
    expect(cryptoMocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'MIND_INSTRUMENT_DRAFT_SAVED',
        metadata: expect.not.objectContaining({
          responses: expect.anything(),
          score: expect.anything(),
        }),
      }),
      test.tx,
    );
  });

  it('recovers only the current draft, with no history creation on read', async () => {
    const test = db();
    await mutateInstrumentDraft(test.tx, context, {
      operation: 'SAVE',
      mutationId: uuid(1),
      expectedRevision: 0,
      responses: { phq9_2: 1 },
    });
    expect(await instrumentDraftState('PHQ9', test.row())).toMatchObject({
      responses: { phq9_2: 1 },
      language: 'en',
    });
    expect(test.upsert).toHaveBeenCalledTimes(1);
    expect(test.response).not.toHaveBeenCalled();
  });

  it('replays the identical save receipt without another write or audit', async () => {
    const test = db();
    const input = {
      operation: 'SAVE' as const,
      mutationId: uuid(1),
      expectedRevision: 0,
      responses: { phq9_1: 2 },
    };
    const receipt = await mutateInstrumentDraft(test.tx, context, input);
    expect(await mutateInstrumentDraft(test.tx, context, input)).toEqual(receipt);
    expect(test.upsert).toHaveBeenCalledTimes(1);
    expect(cryptoMocks.audit).toHaveBeenCalledTimes(1);
    await expect(
      mutateInstrumentDraft(test.tx, context, { ...input, responses: { phq9_1: 3 } }),
    ).rejects.toThrow('different answers');
  });

  it('rejects a concurrent stale revision without losing the saved answer', async () => {
    const test = db();
    await mutateInstrumentDraft(test.tx, context, {
      operation: 'SAVE',
      mutationId: uuid(1),
      expectedRevision: 0,
      responses: { phq9_1: 2 },
    });
    await expect(
      mutateInstrumentDraft(test.tx, context, {
        operation: 'SAVE',
        mutationId: uuid(2),
        expectedRevision: 0,
        responses: { phq9_1: 3 },
      }),
    ).rejects.toThrow('another tab');
    expect(test.upsert).toHaveBeenCalledTimes(1);
    expect((await instrumentDraftState('PHQ9', test.row())).responses).toEqual({ phq9_1: 2 });
  });

  it('submits exactly one complete result and retains a content-free retry tombstone', async () => {
    const test = db();
    await mutateInstrumentDraft(test.tx, context, {
      operation: 'SAVE',
      mutationId: uuid(1),
      expectedRevision: 0,
      responses: complete,
    });
    const submission = { operation: 'SUBMIT' as const, mutationId: uuid(2), expectedRevision: 1 };
    const result = await mutateInstrumentDraft(test.tx, context, submission);
    expect(result).toMatchObject({
      status: 'SUBMITTED',
      revision: 2,
      responses: {},
      submittedResponseId: 'scored-response',
      riskFlagged: true,
    });
    expect(test.row()!.answersEncrypted).toBeNull();
    expect(test.response).toHaveBeenCalledWith({
      data: expect.objectContaining({
        score: 1,
        riskFlagged: true,
        responses: complete,
        language: 'en',
      }),
    });
    expect(await mutateInstrumentDraft(test.tx, context, submission)).toEqual(result);
    expect(test.response).toHaveBeenCalledTimes(1);
    await expect(
      mutateInstrumentDraft(test.tx, context, {
        operation: 'SAVE',
        mutationId: uuid(3),
        expectedRevision: 1,
        responses: complete,
      }),
    ).rejects.toThrow('another tab');
    expect(test.row()!.status).toBe('SUBMITTED');
  });

  it('never creates a scored response from incomplete answers', async () => {
    const test = db();
    await mutateInstrumentDraft(test.tx, context, {
      operation: 'SAVE',
      mutationId: uuid(1),
      expectedRevision: 0,
      responses: { phq9_9: 1 },
    });
    await expect(
      mutateInstrumentDraft(test.tx, context, {
        operation: 'SUBMIT',
        mutationId: uuid(2),
        expectedRevision: 1,
      }),
    ).rejects.toThrow('Answer every item');
    expect(test.response).not.toHaveBeenCalled();
    expect(test.row()!.status).toBe('ACTIVE');
  });

  it('discard creates a tombstone without deleting any scored result or allowing a late save', async () => {
    const test = db();
    await mutateInstrumentDraft(test.tx, context, {
      operation: 'SAVE',
      mutationId: uuid(1),
      expectedRevision: 0,
      responses: { phq9_9: 1 },
    });
    const discard = { operation: 'DISCARD' as const, mutationId: uuid(2), expectedRevision: 1 };
    expect(await mutateInstrumentDraft(test.tx, context, discard)).toMatchObject({
      revision: 2,
      status: 'DISCARDED',
      responses: {},
    });
    expect(await mutateInstrumentDraft(test.tx, context, discard)).toMatchObject({
      revision: 2,
      status: 'DISCARDED',
    });
    expect(test.row()!.answersEncrypted).toBeNull();
    expect(test.response).not.toHaveBeenCalled();
    await expect(
      mutateInstrumentDraft(test.tx, context, {
        operation: 'SAVE',
        mutationId: uuid(3),
        expectedRevision: 1,
        responses: { phq9_9: 1 },
      }),
    ).rejects.toThrow('another tab');
  });

  it('refuses a draft owned by another tenant before decrypting or changing it', async () => {
    const test = db();
    test.seed({ psychologistId: 'another-tenant' } as MindInstrumentDraft);
    await expect(
      mutateInstrumentDraft(test.tx, context, {
        operation: 'SAVE',
        mutationId: uuid(1),
        expectedRevision: 0,
        responses: {},
      }),
    ).rejects.toThrow('Client not found');
    expect(cryptoMocks.decrypt).not.toHaveBeenCalled();
    expect(test.upsert).not.toHaveBeenCalled();
  });

  it('fails closed on corrupted ciphertext rather than silently returning an empty recovered draft', async () => {
    const test = db();
    await mutateInstrumentDraft(test.tx, context, {
      operation: 'SAVE',
      mutationId: uuid(1),
      expectedRevision: 0,
      responses: { phq9_1: 2 },
    });
    test.seed({ ...test.row()!, answersEncrypted: 'corrupt' });
    await expect(instrumentDraftState('PHQ9', test.row())).rejects.toThrow(
      'could not be recovered',
    );
    expect(test.upsert).toHaveBeenCalledTimes(1);
  });

  it('propagates audit failure so the caller transaction rolls back the mutation', async () => {
    const test = db();
    cryptoMocks.audit.mockRejectedValue(new Error('audit unavailable'));
    await expect(
      mutateInstrumentDraft(test.tx, context, {
        operation: 'SAVE',
        mutationId: uuid(1),
        expectedRevision: 0,
        responses: {},
      }),
    ).rejects.toThrow('audit unavailable');
    expect(cryptoMocks.audit.mock.calls[0]![1]).toBe(test.tx);
  });
});

describe('draft contracts and exact curated answers', () => {
  it.each<Record<string, number>>([{ phq9_10: 1 }, { gad7_1: 1 }, { phq9_1: 4 }, { phq9_1: 1.5 }])(
    'rejects invalid partial answers %j',
    (responses) => {
      expect(() => validateDraftAnswers('PHQ9', responses)).toThrow();
    },
  );
  it('does not accept translations, scores or draft answers on submit', () => {
    expect(
      MindInstrumentDraftInputSchema.safeParse({
        operation: 'SAVE',
        mutationId: uuid(1),
        expectedRevision: 0,
        responses: {},
        language: 'ml',
      }).success,
    ).toBe(false);
    expect(
      MindInstrumentDraftInputSchema.safeParse({
        operation: 'SUBMIT',
        mutationId: uuid(1),
        expectedRevision: 1,
        responses: complete,
      }).success,
    ).toBe(false);
    expect(
      MindInstrumentDraftInputSchema.safeParse({
        operation: 'SAVE',
        mutationId: uuid(1),
        expectedRevision: 0,
        responses: {},
        score: 0,
      }).success,
    ).toBe(false);
  });
});
