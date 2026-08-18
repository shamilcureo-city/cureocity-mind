import { createHash } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import {
  IntakeNoteV1Schema,
  MedicalEncounterNoteV1Schema,
  SignNoteInputSchema,
  TherapyNoteV1Schema,
  type NoteEditEntry,
  type NoteEditField,
  type SignedNoteContent,
  type TherapyNote,
} from '@cureocity/contracts';
import { Prisma } from '@prisma/client';
import { isAuthBypassed, requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import {
  SIGNABLE_FIELDS_BY_KIND,
  signableKindFor,
  type SignableKind,
} from '@/lib/note-edit-fields';
import {
  lockAndResolveMedicalSigningAuthority,
  MedicalSigningAuthorizationError,
  type MedicalSigningCredentialSnapshot,
} from '@/lib/medical-signing-authority';
import {
  canonicalJson,
  canonicalSignedRxPad,
  canonicalSigningPayload,
} from '@/lib/sign-note-payload';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';
import { resolveAllowedOrigins, verifyNoteSigningAssertion } from '@/lib/webauthn-verify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

class SigningHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'SigningHttpError';
  }
}

function readField(note: SignedNoteContent, field: NoteEditField): string {
  return (note as unknown as Record<string, unknown>)[field] as string;
}

function validateEdits(
  draft: SignedNoteContent,
  final: SignedNoteContent,
  edits: readonly NoteEditEntry[],
  signable: readonly NoteEditField[],
): void {
  const seen = new Set<NoteEditField>();
  for (const edit of edits) {
    if (!signable.includes(edit.field)) {
      throw new SigningHttpError(400, `edit.field ${edit.field} is not signable`);
    }
    if (seen.has(edit.field)) {
      throw new SigningHttpError(400, `Duplicate edit entry for field ${edit.field}`);
    }
    seen.add(edit.field);
    if (edit.before !== readField(draft, edit.field)) {
      throw new SigningHttpError(
        409,
        `edit.before for ${edit.field} does not match the current locked draft text`,
      );
    }
    if (edit.after !== readField(final, edit.field)) {
      throw new SigningHttpError(400, `edit.after for ${edit.field} does not match the note`);
    }
  }
  for (const field of signable) {
    if (!seen.has(field) && readField(final, field) !== readField(draft, field)) {
      throw new SigningHttpError(400, `Field ${field} changed but is missing from the edits list`);
    }
  }
}

function changedFields(
  beforeNote: SignedNoteContent,
  afterNote: SignedNoteContent,
  fields: readonly NoteEditField[],
): Array<{ field: NoteEditField; before: string; after: string }> {
  const result: Array<{ field: NoteEditField; before: string; after: string }> = [];
  for (const field of fields) {
    const before = readField(beforeNote, field);
    const after = readField(afterNote, field);
    if (typeof before === 'string' && typeof after === 'string' && before !== after) {
      result.push({ field, before, after });
    }
  }
  return result;
}

type LockedSession = {
  id: string;
  psychologistId: string;
  status: string;
  kind: string;
  vertical: string;
};
type LockedDraft = {
  id: string;
  status: string;
  content: Prisma.JsonValue | null;
  rxPad: Prisma.JsonValue | null;
};
type LockedNote = {
  id: string;
  locked: boolean;
  version: string;
  content: Prisma.JsonValue;
  rxPad: Prisma.JsonValue | null;
  signedAt: Date;
  signedBy: string;
  signCredentialId: string | null;
  signClientDataJsonB64u: string | null;
  signAuthenticatorDataB64u: string | null;
  signSignatureB64u: string | null;
  signChallengeHashHex: string | null;
  signPayload: string | null;
  medicalSigningCredentialId: string | null;
  medicalSigningCredentialSnapshot: Prisma.JsonValue | null;
};
type LockedWebAuthnCredential = {
  id: string;
  credentialId: string;
  publicKey: string;
  signCount: number;
};

/**
 * Global signing lock order (never invert): psychologist+session, NoteDraft,
 * TherapyNote, WebAuthnCredential, then medical credential/grant/membership
 * rows in lockAndResolveMedicalSigningAuthority. All mutable authorization and
 * clinical inputs remain locked until note, history, audit and counter commit.
 */
export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await ctx.params;
  const input = await parseJson(req, SignNoteInputSchema);
  if (!input.ok) return input.response;

  const submittedHash = createHash('sha256').update(input.value.payload).digest('hex');
  if (submittedHash !== input.value.payloadHashHex) {
    return NextResponse.json(
      { error: 'payloadHashHex does not match sha256(payload)' },
      { status: 400 },
    );
  }

  let result: {
    note: Awaited<ReturnType<typeof prisma.therapyNote.create>>;
    finalNote: SignedNoteContent;
  };
  try {
    result = await prisma.$transaction(async (tx) => {
      const sessions = await tx.$queryRaw<LockedSession[]>`
        SELECT s."id", s."psychologistId", s."status", s."kind", p."vertical"
        FROM "sessions" s
        INNER JOIN "psychologists" p ON p."id" = s."psychologistId"
        WHERE s."id" = ${sessionId}
        FOR UPDATE OF p, s
      `;
      const session = sessions[0];
      if (!session || session.psychologistId !== auth.value.psychologistId) {
        throw new SigningHttpError(404, 'Session not found');
      }
      if (session.status !== 'COMPLETED') {
        throw new SigningHttpError(409, `Cannot sign a session in ${session.status} state`);
      }

      const drafts = await tx.$queryRaw<LockedDraft[]>`
        SELECT "id", "status", "content", "rxPad"
        FROM "note_drafts"
        WHERE "sessionId" = ${sessionId}
        FOR UPDATE
      `;
      const draft = drafts[0];
      if (!draft) throw new SigningHttpError(404, 'Note draft not found');
      if (draft.status !== 'COMPLETED' || draft.content === null) {
        throw new SigningHttpError(
          409,
          `Note draft is in ${draft.status} state — cannot sign until COMPLETED`,
        );
      }

      const existingRows = await tx.$queryRaw<LockedNote[]>`
        SELECT "id", "locked", "version", "content", "rxPad", "signedAt", "signedBy",
               "signCredentialId", "signClientDataJsonB64u", "signAuthenticatorDataB64u",
               "signSignatureB64u", "signChallengeHashHex", "signPayload", "medicalSigningCredentialId",
               "medicalSigningCredentialSnapshot"
        FROM "therapy_notes"
        WHERE "sessionId" = ${sessionId}
        FOR UPDATE
      `;
      const existing = existingRows[0] ?? null;
      if (existing?.locked) {
        throw new SigningHttpError(409, 'Therapy note already signed for this session');
      }

      const activeCredentials = await tx.$queryRaw<LockedWebAuthnCredential[]>`
        SELECT "id", "credentialId", "publicKey", "signCount"
        FROM "webauthn_credentials"
        WHERE "psychologistId" = ${auth.value.psychologistId} AND "revokedAt" IS NULL
        ORDER BY "id"
        FOR UPDATE
      `;

      const signableKind: SignableKind = signableKindFor(
        session.kind as never,
        session.vertical as never,
      );
      const noteSchema =
        signableKind === 'INTAKE'
          ? IntakeNoteV1Schema
          : signableKind === 'MEDICAL'
            ? MedicalEncounterNoteV1Schema
            : TherapyNoteV1Schema;
      const signableFields = SIGNABLE_FIELDS_BY_KIND[signableKind];
      const parsedDraft = noteSchema.safeParse(draft.content);
      if (!parsedDraft.success) {
        throw new SigningHttpError(409, 'Locked note draft has an invalid clinical shape');
      }
      const parsedFinal = noteSchema.safeParse(input.value.note);
      if (!parsedFinal.success) {
        throw new SigningHttpError(400, 'Submitted note does not match this session kind');
      }
      const draftContent = parsedDraft.data as SignedNoteContent;
      const finalNote = parsedFinal.data as SignedNoteContent;
      const edits = input.value.edits ?? [];
      validateEdits(draftContent, finalNote, edits, signableFields);

      const signedRxPad =
        signableKind === 'MEDICAL' && draft.rxPad !== null
          ? canonicalSignedRxPad(draft.rxPad)
          : null;
      if (signableKind === 'MEDICAL' && draft.rxPad !== null && signedRxPad === null) {
        throw new SigningHttpError(409, 'Locked prescription draft has an invalid shape');
      }
      const draftContentHashHex = createHash('sha256')
        .update(canonicalJson(draftContent))
        .digest('hex');
      const canonicalPayload = canonicalSigningPayload({
        sessionId,
        draftContentHashHex,
        note: finalNote,
        edits,
        signedAt: input.value.signedAt,
        safetyOverride: input.value.safetyOverride,
        rxPad: signedRxPad,
      });
      if (input.value.payload !== canonicalPayload) {
        throw new SigningHttpError(
          409,
          'Signing payload does not match the current locked session, draft, note, edits, override, and Rx',
        );
      }
      const canonicalHash = createHash('sha256').update(canonicalPayload).digest('hex');
      if (canonicalHash !== input.value.payloadHashHex) {
        throw new SigningHttpError(
          400,
          'payloadHashHex does not match the canonical signing payload',
        );
      }
      if (
        input.value.assertion?.challengeHashHex !== undefined &&
        input.value.assertion.challengeHashHex !== canonicalHash
      ) {
        throw new SigningHttpError(
          400,
          'WebAuthn challenge does not match the canonical payload hash',
        );
      }

      if (
        activeCredentials.length === 0 &&
        process.env['REQUIRE_WEBAUTHN_SIGNING'] === 'true' &&
        !isAuthBypassed()
      ) {
        throw new SigningHttpError(
          403,
          'A passkey is required to sign notes. Set one up in Settings → Security, then sign the note.',
        );
      }

      let credentialBump: { id: string; newSignCount: number } | null = null;
      if (activeCredentials.length > 0) {
        if (!input.value.assertion) {
          throw new SigningHttpError(
            401,
            'WebAuthn assertion required — at least one credential is registered for this account.',
          );
        }
        const matched = activeCredentials.find(
          (credential) => credential.credentialId === input.value.assertion!.credentialId,
        );
        if (!matched) {
          throw new SigningHttpError(
            401,
            'Assertion credentialId does not match any registered credential for this account.',
          );
        }
        const verification = verifyNoteSigningAssertion({
          publicKeySpkiB64Url: matched.publicKey,
          authenticatorDataB64Url: input.value.assertion.authenticatorData,
          clientDataJsonB64Url: input.value.assertion.clientDataJSON,
          signatureB64Url: input.value.assertion.signature,
          expectedChallengeHashHex: canonicalHash,
          expectedRpId: process.env['WEBAUTHN_RP_ID'] ?? new URL(req.url).hostname,
          allowedOrigins: resolveAllowedOrigins(),
          storedSignCount: matched.signCount,
        });
        if (!verification.ok) {
          throw new SigningHttpError(
            401,
            `WebAuthn assertion verification failed: ${verification.reason}`,
          );
        }
        credentialBump = { id: matched.id, newSignCount: verification.newSignCount };
      }

      const medicalAuthority: MedicalSigningCredentialSnapshot | null =
        signableKind === 'MEDICAL'
          ? await lockAndResolveMedicalSigningAuthority(tx, auth.value.psychologistId, new Date())
          : null;
      let transactionEdits = edits;
      if (existing) {
        const parsedExisting = noteSchema.safeParse(existing.content);
        if (!parsedExisting.success) {
          throw new SigningHttpError(409, 'Prior signed note has an invalid clinical shape');
        }
        transactionEdits = changedFields(
          parsedExisting.data as SignedNoteContent,
          finalNote,
          signableFields,
        );
      }

      if (existing?.signPayload !== null && existing?.signPayload !== undefined) {
        await tx.noteSignatureVersion.create({
          data: {
            therapyNoteId: existing.id,
            version: existing.version,
            content: existing.content as Prisma.InputJsonValue,
            rxPad:
              existing.rxPad === null ? Prisma.DbNull : (existing.rxPad as Prisma.InputJsonValue),
            signedAt: existing.signedAt,
            signedBy: existing.signedBy,
            signCredentialId: existing.signCredentialId,
            signClientDataJsonB64u: existing.signClientDataJsonB64u,
            signAuthenticatorDataB64u: existing.signAuthenticatorDataB64u,
            signSignatureB64u: existing.signSignatureB64u,
            signChallengeHashHex: existing.signChallengeHashHex,
            signPayload: existing.signPayload,
            medicalSigningCredentialId: existing.medicalSigningCredentialId,
            medicalSigningCredentialSnapshot:
              existing.medicalSigningCredentialSnapshot === null
                ? Prisma.DbNull
                : (existing.medicalSigningCredentialSnapshot as Prisma.InputJsonValue),
            contentHashHex: createHash('sha256')
              .update(canonicalJson(existing.content))
              .digest('hex'),
          },
        });
      }

      const noteData = {
        version: finalNote.version,
        content: finalNote as unknown as Prisma.InputJsonValue,
        rxPad:
          signedRxPad === null ? Prisma.DbNull : (signedRxPad as unknown as Prisma.InputJsonValue),
        signedAt: new Date(input.value.signedAt),
        signedBy: auth.value.psychologistId,
        locked: true,
        signCredentialId: input.value.assertion?.credentialId ?? null,
        signClientDataJsonB64u: input.value.assertion?.clientDataJSON ?? null,
        signAuthenticatorDataB64u: input.value.assertion?.authenticatorData ?? null,
        signSignatureB64u: input.value.assertion?.signature ?? null,
        signChallengeHashHex: canonicalHash,
        signPayload: canonicalPayload,
        medicalSigningCredentialId: medicalAuthority?.id ?? null,
        medicalSigningCredentialSnapshot:
          medicalAuthority === null
            ? Prisma.DbNull
            : (medicalAuthority as unknown as Prisma.InputJsonValue),
      };
      if (existing) {
        await tx.$executeRaw`
          SELECT set_config('app.therapy_note_write_context', 'signing', true)
        `;
      }
      const note = existing
        ? await tx.therapyNote.update({ where: { id: existing.id }, data: noteData })
        : await tx.therapyNote.create({ data: { sessionId, draftId: draft.id, ...noteData } });

      if (transactionEdits.length > 0) {
        await tx.noteEdit.createMany({
          data: transactionEdits.map((edit) => ({ therapyNoteId: note.id, ...edit })),
        });
      }
      const auditBase = {
        actorType: 'PSYCHOLOGIST' as const,
        actorPsychologistId: auth.value.psychologistId,
        targetType: 'TherapyNote',
        targetId: note.id,
        metadata: {
          ...auditMetadataFromRequest(req),
          sessionId,
          draftId: draft.id,
          draftContentHashHex,
          editedFields: transactionEdits.map((edit) => edit.field),
          resign: existing !== null,
          payloadHashHex: canonicalHash,
          webauthnUsed: input.value.assertion !== undefined,
          webauthnEnforced: credentialBump !== null,
          kind: signableKind,
          ...(medicalAuthority && {
            medicalSigningCredentialId: medicalAuthority.id,
            medicalSigningCredentialKind: medicalAuthority.kind,
            medicalSigningCredentialJurisdiction: medicalAuthority.jurisdiction,
          }),
        },
      };
      if (signableKind === 'MEDICAL') {
        await writeAudit({ ...auditBase, action: 'ENCOUNTER_NOTE_SIGNED' }, tx);
      } else {
        await writeAudit({ ...auditBase, action: 'NOTE_SIGNED' }, tx);
      }
      if (input.value.safetyOverride) {
        const blockers = input.value.safetyOverride.blockers ?? [];
        await writeAudit(
          {
            ...auditBase,
            action: 'RX_SAFETY_OVERRIDE',
            metadata: {
              ...auditBase.metadata,
              reasonCode: input.value.safetyOverride.reasonCode,
              reasonHashHex: createHash('sha256')
                .update(input.value.safetyOverride.reason)
                .digest('hex'),
              blockerCount: blockers.length,
              blockerHashes: blockers.map((blocker) =>
                createHash('sha256').update(blocker).digest('hex'),
              ),
              signedNoteId: note.id,
            },
          },
          tx,
        );
      }
      if (credentialBump) {
        await tx.webAuthnCredential.update({
          where: { id: credentialBump.id },
          data: { lastUsedAt: new Date(), signCount: credentialBump.newSignCount },
        });
      }
      return { note, finalNote };
    });
  } catch (error) {
    if (error instanceof SigningHttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof MedicalSigningAuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json(
        { error: 'Note was signed concurrently; reload and review the saved signature' },
        { status: 409 },
      );
    }
    throw error;
  }

  const persistedEdits = await prisma.noteEdit.findMany({
    where: { therapyNoteId: result.note.id },
    orderBy: { createdAt: 'asc' },
  });
  const created = result.note;
  const body: TherapyNote = {
    id: created.id,
    sessionId: created.sessionId,
    draftId: created.draftId,
    version: 'V1',
    content: result.finalNote,
    signedAt: created.signedAt.toISOString(),
    signedBy: created.signedBy,
    edits: persistedEdits.map((edit) => ({
      id: edit.id,
      field: edit.field,
      before: edit.before,
      after: edit.after,
      createdAt: edit.createdAt.toISOString(),
    })),
    signCredentialId: created.signCredentialId,
    signChallengeHashHex: created.signChallengeHashHex,
    createdAt: created.createdAt.toISOString(),
  };
  return NextResponse.json(body, { status: 201 });
}
