import { createHash } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { canonicalJson } from '@/lib/sign-note-payload';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PROOF_CONFLICT =
  'Signed note proof is incomplete or does not match the stored clinical version';

class UnlockHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'UnlockHttpError';
  }
}

type LockedSession = { id: string; psychologistId: string };
type LockedDraft = { id: string };
type LockedNote = {
  id: string;
  draftId: string;
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

type StoredPayload = {
  sessionId?: unknown;
  note?: unknown;
  rxPad?: unknown;
  signedAt?: unknown;
};

function assertPayloadBoundVersion(note: LockedNote, sessionId: string): void {
  if (!note.signPayload || !note.signChallengeHashHex)
    throw new UnlockHttpError(409, PROOF_CONFLICT);

  let payload: StoredPayload;
  try {
    payload = JSON.parse(note.signPayload) as StoredPayload;
  } catch {
    throw new UnlockHttpError(409, PROOF_CONFLICT);
  }
  const payloadHash = createHash('sha256').update(note.signPayload).digest('hex');
  const webauthnFields = [
    note.signClientDataJsonB64u,
    note.signAuthenticatorDataB64u,
    note.signSignatureB64u,
  ];
  const webauthnComplete =
    note.signCredentialId === null
      ? webauthnFields.every((field) => field === null)
      : webauthnFields.every((field) => field !== null);
  if (
    payload.sessionId !== sessionId ||
    canonicalJson(payload.note) !== canonicalJson(note.content) ||
    canonicalJson(payload.rxPad) !== canonicalJson(note.rxPad) ||
    payload.signedAt !== note.signedAt.toISOString() ||
    payloadHash !== note.signChallengeHashHex ||
    !webauthnComplete
  ) {
    throw new UnlockHttpError(409, PROOF_CONFLICT);
  }
}

/**
 * Re-open a signed note through the same global row-lock order used by signing:
 * Session, NoteDraft, TherapyNote, then WebAuthn credential. The prior signed
 * version is archived before its active proof is cleared and the draft seeded.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await params;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const sessions = await tx.$queryRaw<LockedSession[]>`
        SELECT "id", "psychologistId"
        FROM "sessions"
        WHERE "id" = ${sessionId}
        FOR UPDATE
      `;
      const session = sessions[0];
      if (!session || session.psychologistId !== auth.value.psychologistId) {
        throw new UnlockHttpError(404, 'Session not found');
      }

      const drafts = await tx.$queryRaw<LockedDraft[]>`
        SELECT "id"
        FROM "note_drafts"
        WHERE "sessionId" = ${sessionId}
        FOR UPDATE
      `;
      const draft = drafts[0];
      if (!draft) throw new UnlockHttpError(404, 'Note draft not found');

      const notes = await tx.$queryRaw<LockedNote[]>`
        SELECT "id", "draftId", "locked", "version", "content", "rxPad", "signedAt", "signedBy",
               "signCredentialId", "signClientDataJsonB64u", "signAuthenticatorDataB64u",
               "signSignatureB64u", "signChallengeHashHex", "signPayload", "medicalSigningCredentialId",
               "medicalSigningCredentialSnapshot"
        FROM "therapy_notes"
        WHERE "sessionId" = ${sessionId}
        FOR UPDATE
      `;
      const note = notes[0];
      if (!note) throw new UnlockHttpError(404, 'No signed note to unlock.');
      if (note.draftId !== draft.id) throw new UnlockHttpError(409, PROOF_CONFLICT);

      const credentialRows = await tx.$queryRaw<Array<{ id: string; credentialId: string }>>`
        SELECT "id", "credentialId"
        FROM "webauthn_credentials"
        WHERE "psychologistId" = ${auth.value.psychologistId}
          AND "credentialId" = ${note.signCredentialId}
        ORDER BY "id"
        FOR UPDATE
      `;

      if (!note.locked) return { archivedSignatureVersionId: null };
      assertPayloadBoundVersion(note, sessionId);
      if (note.signCredentialId !== null && credentialRows.length !== 1) {
        throw new UnlockHttpError(409, PROOF_CONFLICT);
      }

      const archived = await tx.noteSignatureVersion.create({
        data: {
          therapyNoteId: note.id,
          version: note.version,
          content: note.content as Prisma.InputJsonValue,
          contentHashHex: createHash('sha256').update(canonicalJson(note.content)).digest('hex'),
          rxPad: note.rxPad === null ? Prisma.DbNull : (note.rxPad as Prisma.InputJsonValue),
          signedAt: note.signedAt,
          signedBy: note.signedBy,
          signCredentialId: note.signCredentialId,
          signClientDataJsonB64u: note.signClientDataJsonB64u,
          signAuthenticatorDataB64u: note.signAuthenticatorDataB64u,
          signSignatureB64u: note.signSignatureB64u,
          signChallengeHashHex: note.signChallengeHashHex,
          signPayload: note.signPayload,
          medicalSigningCredentialId: note.medicalSigningCredentialId,
          medicalSigningCredentialSnapshot:
            note.medicalSigningCredentialSnapshot === null
              ? Prisma.DbNull
              : (note.medicalSigningCredentialSnapshot as Prisma.InputJsonValue),
        },
      });

      await tx.therapyNote.update({
        where: { id: note.id },
        data: {
          locked: false,
          signCredentialId: null,
          signClientDataJsonB64u: null,
          signAuthenticatorDataB64u: null,
          signSignatureB64u: null,
          signChallengeHashHex: null,
          signPayload: null,
          medicalSigningCredentialId: null,
          medicalSigningCredentialSnapshot: Prisma.DbNull,
        },
      });
      await tx.noteDraft.update({
        where: { id: draft.id },
        data: {
          content: note.content as Prisma.InputJsonValue,
          rxPad: note.rxPad === null ? Prisma.DbNull : (note.rxPad as Prisma.InputJsonValue),
          status: 'COMPLETED',
        },
      });
      await writeAudit(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: auth.value.psychologistId,
          action: 'NOTE_UNLOCKED',
          targetType: 'TherapyNote',
          targetId: note.id,
          metadata: {
            ...auditMetadataFromRequest(req),
            sessionId,
            archivedSignatureVersionId: archived.id,
          },
        },
        tx,
      );
      return { archivedSignatureVersionId: archived.id };
    });

    return NextResponse.json({ ok: true, locked: false, ...result });
  } catch (error) {
    if (error instanceof UnlockHttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === 'P2002' || error.code === 'P2025')
    ) {
      return NextResponse.json(
        { error: 'Note state changed concurrently; reload before editing' },
        { status: 409 },
      );
    }
    throw error;
  }
}
