import { createHash } from 'node:crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { SignNoteInput, TherapyNoteV1, WebAuthnAssertion } from '@cureocity/contracts';
import { SignService } from './sign.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';

const PSY_ID = 'cpsyaaaaaaaaaaaaaaaaaaaaa';
const OTHER_PSY_ID = 'cpsybbbbbbbbbbbbbbbbbbbbb';
const SESSION_ID = 'csess11111111111111111111';
const DRAFT_ID = 'cdraft1111111111111111111';
const NOTE_ID = 'cnote11111111111111111111';

const draftContent: TherapyNoteV1 = {
  version: 'V1',
  modality: 'CBT',
  subjective: 'Client reports ongoing anxiety about work deadlines.',
  objective: 'Client maintained eye contact, speech slightly pressured.',
  assessment: 'Mild GAD with situational triggers.',
  plan: 'Continue weekly CBT; assign thought record for week.',
  riskFlags: { severity: 'none', indicators: [] },
  phaseHints: [],
};

const editedNote: TherapyNoteV1 = {
  ...draftContent,
  assessment: 'Moderate GAD with situational triggers; rule out work-related burnout.',
};

function makeAssertion(challengeHashHex: string): WebAuthnAssertion {
  return {
    credentialId: 'Y3JlZGVudGlhbA',
    clientDataJSON: 'Y2xpZW50RGF0YQ',
    authenticatorData: 'YXV0aERhdGE',
    signature: 'c2lnbmF0dXJl',
    challengeHashHex,
  };
}

function makeInput(overrides?: {
  noteOverride?: TherapyNoteV1;
  edits?: SignNoteInput['edits'];
  withAssertion?: boolean;
  signedAt?: string;
}): SignNoteInput {
  const note = overrides?.noteOverride ?? editedNote;
  const edits = overrides?.edits ?? [
    {
      field: 'assessment',
      before: draftContent.assessment,
      after: editedNote.assessment,
    },
  ];
  const signedAt = overrides?.signedAt ?? '2026-05-26T14:30:00.000Z';
  const payload = JSON.stringify({ sessionId: SESSION_ID, note, edits, signedAt });
  const payloadHashHex = createHash('sha256').update(payload).digest('hex');
  return {
    payload,
    payloadHashHex,
    note,
    edits,
    signedAt,
    ...(overrides?.withAssertion ? { assertion: makeAssertion(payloadHashHex) } : {}),
  };
}

function makeDeps(opts?: {
  session?: { psychologistId: string; status: string } | null;
  draft?: {
    id: string;
    status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
    content: TherapyNoteV1 | null;
  } | null;
  existingNote?: { id: string } | null;
  noteCreate?: ReturnType<typeof vi.fn>;
  noteEditCreateMany?: ReturnType<typeof vi.fn>;
  noteEditFindMany?: ReturnType<typeof vi.fn>;
}) {
  const sessionFindUnique = vi
    .fn()
    .mockResolvedValue(
      opts?.session === undefined ? { psychologistId: PSY_ID, status: 'COMPLETED' } : opts.session,
    );
  const draftFindUnique = vi
    .fn()
    .mockResolvedValue(
      opts?.draft === undefined
        ? { id: DRAFT_ID, status: 'COMPLETED', content: draftContent }
        : opts.draft,
    );
  const therapyNoteFindUnique = vi
    .fn()
    .mockResolvedValue(opts?.existingNote === undefined ? null : opts.existingNote);
  const noteCreate =
    opts?.noteCreate ??
    vi.fn().mockResolvedValue({
      id: NOTE_ID,
      sessionId: SESSION_ID,
      draftId: DRAFT_ID,
      version: 'V1',
      content: editedNote,
      signedAt: new Date('2026-05-26T14:30:00.000Z'),
      signedBy: PSY_ID,
      signCredentialId: null,
      signClientDataJsonB64u: null,
      signAuthenticatorDataB64u: null,
      signSignatureB64u: null,
      signChallengeHashHex: null,
      createdAt: new Date('2026-05-26T14:30:00.000Z'),
    });
  const noteEditCreateMany = opts?.noteEditCreateMany ?? vi.fn().mockResolvedValue({ count: 1 });
  const noteEditFindMany =
    opts?.noteEditFindMany ??
    vi.fn().mockResolvedValue([
      {
        id: 'cedit1aaaaaaaaaaaaaaaaaaa',
        field: 'assessment',
        before: draftContent.assessment,
        after: editedNote.assessment,
        createdAt: new Date('2026-05-26T14:30:00.000Z'),
      },
    ]);

  const txClient = {
    therapyNote: { create: noteCreate },
    noteEdit: { createMany: noteEditCreateMany },
    auditLog: { create: vi.fn() },
  };
  const transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(txClient));

  const prisma = {
    session: { findUnique: sessionFindUnique },
    noteDraft: { findUnique: draftFindUnique },
    therapyNote: { findUnique: therapyNoteFindUnique },
    noteEdit: { findMany: noteEditFindMany },
    $transaction: transaction,
  } as unknown as PrismaService;

  const audit = { log: vi.fn() } as unknown as AuditService;

  return {
    prisma,
    audit,
    sessionFindUnique,
    draftFindUnique,
    therapyNoteFindUnique,
    noteCreate,
    noteEditCreateMany,
    noteEditFindMany,
  };
}

describe('SignService.sign', () => {
  beforeEach(() => vi.clearAllMocks());

  it('happy path: creates TherapyNote + NoteEdit rows and writes NOTE_SIGNED audit', async () => {
    const deps = makeDeps();
    const svc = new SignService(deps.prisma, deps.audit);
    const input = makeInput({ withAssertion: true });

    const result = await svc.sign(PSY_ID, SESSION_ID, input, { requestId: 'req-1' });

    expect(result.id).toBe(NOTE_ID);
    expect(result.signedBy).toBe(PSY_ID);
    // content is the SignedNoteContent union; this path signs a TREATMENT note.
    expect((result.content as TherapyNoteV1).assessment).toBe(editedNote.assessment);
    expect(result.edits).toHaveLength(1);
    expect(result.edits[0]?.field).toBe('assessment');
    expect(deps.noteCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sessionId: SESSION_ID,
          draftId: DRAFT_ID,
          signedBy: PSY_ID,
          signCredentialId: input.assertion!.credentialId,
        }),
      }),
    );
    expect(deps.noteEditCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          therapyNoteId: NOTE_ID,
          field: 'assessment',
          before: draftContent.assessment,
          after: editedNote.assessment,
        }),
      ],
    });
    expect(deps.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'NOTE_SIGNED',
        targetId: NOTE_ID,
        metadata: expect.objectContaining({
          sessionId: SESSION_ID,
          editedFields: ['assessment'],
          webauthnUsed: true,
        }),
      }),
      expect.anything(),
    );
  });

  it('signs without assertion (degraded path) and still records the challenge hash', async () => {
    const deps = makeDeps();
    const svc = new SignService(deps.prisma, deps.audit);
    const input = makeInput();

    await svc.sign(PSY_ID, SESSION_ID, input, {});

    expect(deps.noteCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          signCredentialId: null,
          signChallengeHashHex: input.payloadHashHex,
        }),
      }),
    );
  });

  it('rejects when payloadHashHex does not match sha256(payload)', async () => {
    const deps = makeDeps();
    const svc = new SignService(deps.prisma, deps.audit);
    const input = makeInput();
    const tampered: SignNoteInput = {
      ...input,
      payloadHashHex: 'a'.repeat(64),
    };

    await expect(svc.sign(PSY_ID, SESSION_ID, tampered, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(deps.noteCreate).not.toHaveBeenCalled();
  });

  it('rejects when WebAuthn assertion challenge does not match the payload hash', async () => {
    const deps = makeDeps();
    const svc = new SignService(deps.prisma, deps.audit);
    const input = makeInput({ withAssertion: true });
    const tampered: SignNoteInput = {
      ...input,
      assertion: { ...input.assertion!, challengeHashHex: 'b'.repeat(64) },
    };

    await expect(svc.sign(PSY_ID, SESSION_ID, tampered, {})).rejects.toThrow(/replay|substitution/);
  });

  it('rejects with 404 when session belongs to another psychologist', async () => {
    const deps = makeDeps({
      session: { psychologistId: OTHER_PSY_ID, status: 'COMPLETED' },
    });
    const svc = new SignService(deps.prisma, deps.audit);

    await expect(svc.sign(PSY_ID, SESSION_ID, makeInput(), {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects when session is not COMPLETED', async () => {
    const deps = makeDeps({
      session: { psychologistId: PSY_ID, status: 'IN_PROGRESS' },
    });
    const svc = new SignService(deps.prisma, deps.audit);

    await expect(svc.sign(PSY_ID, SESSION_ID, makeInput(), {})).rejects.toThrow(/COMPLETED/);
  });

  it('rejects when the draft is not COMPLETED', async () => {
    const deps = makeDeps({
      draft: { id: DRAFT_ID, status: 'IN_PROGRESS', content: null },
    });
    const svc = new SignService(deps.prisma, deps.audit);

    await expect(svc.sign(PSY_ID, SESSION_ID, makeInput(), {})).rejects.toThrow(/IN_PROGRESS/);
  });

  it('rejects with 409 when a TherapyNote already exists for the session (idempotency)', async () => {
    const deps = makeDeps({ existingNote: { id: NOTE_ID } });
    const svc = new SignService(deps.prisma, deps.audit);

    await expect(svc.sign(PSY_ID, SESSION_ID, makeInput(), {})).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rejects when edit.before disagrees with the persisted draft (stale draft)', async () => {
    const deps = makeDeps();
    const svc = new SignService(deps.prisma, deps.audit);
    const input = makeInput({
      edits: [
        {
          field: 'assessment',
          before: 'something the draft never said',
          after: editedNote.assessment,
        },
      ],
    });

    await expect(svc.sign(PSY_ID, SESSION_ID, input, {})).rejects.toThrow(/stale draft/);
  });

  it('rejects when the final note silently changed a field without an edit row', async () => {
    const deps = makeDeps();
    const svc = new SignService(deps.prisma, deps.audit);
    const sneaky: TherapyNoteV1 = {
      ...editedNote,
      plan: 'A change that the edits[] list does not declare.',
    };
    const input = makeInput({ noteOverride: sneaky });

    await expect(svc.sign(PSY_ID, SESSION_ID, input, {})).rejects.toThrow(
      /plan changed but is missing from the edits list/,
    );
  });

  it('accepts an unedited sign (no edits, identical note)', async () => {
    const deps = makeDeps({
      noteCreate: vi.fn().mockResolvedValue({
        id: NOTE_ID,
        sessionId: SESSION_ID,
        draftId: DRAFT_ID,
        version: 'V1',
        content: draftContent,
        signedAt: new Date('2026-05-26T14:30:00.000Z'),
        signedBy: PSY_ID,
        signCredentialId: null,
        signClientDataJsonB64u: null,
        signAuthenticatorDataB64u: null,
        signSignatureB64u: null,
        signChallengeHashHex: null,
        createdAt: new Date('2026-05-26T14:30:00.000Z'),
      }),
      noteEditFindMany: vi.fn().mockResolvedValue([]),
    });
    const svc = new SignService(deps.prisma, deps.audit);
    const input = makeInput({ noteOverride: draftContent, edits: [] });

    const result = await svc.sign(PSY_ID, SESSION_ID, input, {});

    expect(result.edits).toHaveLength(0);
    expect(deps.noteEditCreateMany).not.toHaveBeenCalled();
  });

  it('rejects duplicate edit entries for the same field', async () => {
    const deps = makeDeps();
    const svc = new SignService(deps.prisma, deps.audit);
    const input = makeInput({
      edits: [
        {
          field: 'assessment',
          before: draftContent.assessment,
          after: editedNote.assessment,
        },
        {
          field: 'assessment',
          before: draftContent.assessment,
          after: editedNote.assessment,
        },
      ],
    });

    await expect(svc.sign(PSY_ID, SESSION_ID, input, {})).rejects.toThrow(/Duplicate edit/);
  });
});

// Ensure Prisma.Decimal is reachable in the test environment (otherwise the
// dynamic import of Prisma above is treated as unused).
void Prisma.Decimal;
