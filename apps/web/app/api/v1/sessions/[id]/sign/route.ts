import { createHash } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import {
  SignNoteInputSchema,
  TherapyNoteV1Schema,
  type NoteEditEntry,
  type NoteEditField,
  type TherapyNote,
  type TherapyNoteV1,
} from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SIGNABLE: readonly NoteEditField[] = ['subjective', 'objective', 'assessment', 'plan'];

interface RouteContext {
  params: Promise<{ id: string }>;
}

function validateEdits(
  draft: TherapyNoteV1,
  final: TherapyNoteV1,
  edits: readonly NoteEditEntry[],
): NextResponse | null {
  const seen = new Set<NoteEditField>();
  for (const e of edits) {
    if (!SIGNABLE.includes(e.field)) {
      return NextResponse.json({ error: `edit.field ${e.field} is not signable` }, { status: 400 });
    }
    if (seen.has(e.field)) {
      return NextResponse.json(
        { error: `Duplicate edit entry for field ${e.field}` },
        { status: 400 },
      );
    }
    seen.add(e.field);
    if (e.before !== draft[e.field]) {
      return NextResponse.json(
        {
          error: `edit.before for ${e.field} does not match the current draft text (stale draft?)`,
        },
        { status: 400 },
      );
    }
    if (e.after !== final[e.field]) {
      return NextResponse.json(
        { error: `edit.after for ${e.field} does not match the submitted note` },
        { status: 400 },
      );
    }
  }
  for (const field of SIGNABLE) {
    if (!seen.has(field) && final[field] !== draft[field]) {
      return NextResponse.json(
        { error: `Field ${field} changed but is missing from the edits list` },
        { status: 400 },
      );
    }
  }
  return null;
}

/**
 * POST /api/v1/sessions/:id/sign — WebAuthn note sign-off.
 *
 * Verification chain (ported from scribe-service SignService):
 *   1. sha256(payload) === payloadHashHex
 *   2. sha256(payload) === assertion.challengeHashHex (when present)
 *   3. note matches TherapyNoteV1Schema
 *   4. edits[].before/after consistent with draft + final note
 * Creates TherapyNote + NoteEdit rows + NOTE_SIGNED audit in a single tx.
 */
export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await ctx.params;
  const input = await parseJson(req, SignNoteInputSchema);
  if (!input.ok) return input.response;

  const recomputed = createHash('sha256').update(input.value.payload).digest('hex');
  if (recomputed !== input.value.payloadHashHex) {
    return NextResponse.json(
      { error: 'payloadHashHex does not match sha256(payload)' },
      { status: 400 },
    );
  }
  if (input.value.assertion && input.value.assertion.challengeHashHex !== recomputed) {
    return NextResponse.json(
      { error: 'WebAuthn challenge does not match the payload hash' },
      { status: 400 },
    );
  }

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { psychologistId: true, status: true },
  });
  if (!session || session.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  if (session.status !== 'COMPLETED') {
    return NextResponse.json(
      { error: `Cannot sign a session in ${session.status} state` },
      { status: 400 },
    );
  }

  // Sprint 18 — once the therapist has registered ≥1 platform
  // authenticator, the assertion is REQUIRED and its credentialId
  // must match a known non-revoked row. If they have none registered,
  // we keep the historical optional-assertion behaviour so existing
  // dev / pilot flows don't break.
  const activeCredentials = await prisma.webAuthnCredential.findMany({
    where: { psychologistId: auth.value.psychologistId, revokedAt: null },
    select: { id: true, credentialId: true, signCount: true },
  });
  let credentialIdToBump: string | null = null;
  if (activeCredentials.length > 0) {
    if (!input.value.assertion) {
      return NextResponse.json(
        {
          error:
            'WebAuthn assertion required — at least one credential is registered for this account.',
        },
        { status: 401 },
      );
    }
    const matched = activeCredentials.find(
      (c) => c.credentialId === input.value.assertion!.credentialId,
    );
    if (!matched) {
      return NextResponse.json(
        {
          error:
            'Assertion credentialId does not match any registered credential for this account.',
        },
        { status: 401 },
      );
    }
    credentialIdToBump = matched.id;
  }

  const draft = await prisma.noteDraft.findUnique({ where: { sessionId } });
  if (!draft) return NextResponse.json({ error: 'Note draft not found' }, { status: 404 });
  if (draft.status !== 'COMPLETED' || draft.content === null) {
    return NextResponse.json(
      { error: `Note draft is in ${draft.status} state — cannot sign until COMPLETED` },
      { status: 400 },
    );
  }
  const existing = await prisma.therapyNote.findUnique({
    where: { sessionId },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json(
      { error: 'Therapy note already signed for this session' },
      { status: 409 },
    );
  }

  const draftContent = TherapyNoteV1Schema.parse(draft.content);
  const finalNote = TherapyNoteV1Schema.parse(input.value.note);
  // Zod default([]) — runtime is [], TS sees optional under
  // exactOptionalPropertyTypes: false. Coalesce defensively.
  const edits = input.value.edits ?? [];
  const editsError = validateEdits(draftContent, finalNote, edits);
  if (editsError) return editsError;

  const created = await prisma.$transaction(async (tx) => {
    const note = await tx.therapyNote.create({
      data: {
        sessionId,
        draftId: draft.id,
        version: finalNote.version,
        content: finalNote as unknown as object,
        signedAt: new Date(input.value.signedAt),
        signedBy: auth.value.psychologistId,
        signCredentialId: input.value.assertion?.credentialId ?? null,
        signClientDataJsonB64u: input.value.assertion?.clientDataJSON ?? null,
        signAuthenticatorDataB64u: input.value.assertion?.authenticatorData ?? null,
        signSignatureB64u: input.value.assertion?.signature ?? null,
        signChallengeHashHex: input.value.assertion?.challengeHashHex ?? recomputed,
      },
    });
    if (edits.length > 0) {
      await tx.noteEdit.createMany({
        data: edits.map((e) => ({
          therapyNoteId: note.id,
          field: e.field,
          before: e.before,
          after: e.after,
        })),
      });
    }
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'NOTE_SIGNED',
        targetType: 'TherapyNote',
        targetId: note.id,
        metadata: {
          ...auditMetadataFromRequest(req),
          sessionId,
          draftId: draft.id,
          editedFields: edits.map((e) => e.field),
          payloadHashHex: recomputed,
          webauthnUsed: input.value.assertion !== undefined,
          webauthnEnforced: credentialIdToBump !== null,
        },
      },
      tx,
    );
    if (credentialIdToBump !== null) {
      await tx.webAuthnCredential.update({
        where: { id: credentialIdToBump },
        data: { lastUsedAt: new Date(), signCount: { increment: 1 } },
      });
    }
    return note;
  });

  const persistedEdits = await prisma.noteEdit.findMany({
    where: { therapyNoteId: created.id },
    orderBy: { createdAt: 'asc' },
  });

  const body: TherapyNote = {
    id: created.id,
    sessionId: created.sessionId,
    draftId: created.draftId,
    version: 'V1',
    content: finalNote,
    signedAt: created.signedAt.toISOString(),
    signedBy: created.signedBy,
    edits: persistedEdits.map((e) => ({
      id: e.id,
      field: e.field,
      before: e.before,
      after: e.after,
      createdAt: e.createdAt.toISOString(),
    })),
    signCredentialId: created.signCredentialId,
    signChallengeHashHex: created.signChallengeHashHex,
    createdAt: created.createdAt.toISOString(),
  };
  return NextResponse.json(body, { status: 201 });
}
