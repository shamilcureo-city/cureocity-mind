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
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import {
  SIGNABLE_FIELDS_BY_KIND,
  signableKindFor,
  type SignableKind,
} from '@/lib/note-edit-fields';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';
import { resolveAllowedOrigins, verifyNoteSigningAssertion } from '@/lib/webauthn-verify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Signable field sets + the session-kind → note-shape mapping live in
// a shared module (apps/web/lib/note-edit-fields.ts) so this route and
// the post-sign edit route stay in lockstep.

interface RouteContext {
  params: Promise<{ id: string }>;
}

function readField(note: SignedNoteContent, field: NoteEditField): string {
  return (note as unknown as Record<string, unknown>)[field] as string;
}

function validateEdits(
  draft: SignedNoteContent,
  final: SignedNoteContent,
  edits: readonly NoteEditEntry[],
  signable: readonly NoteEditField[],
): NextResponse | null {
  const seen = new Set<NoteEditField>();
  for (const e of edits) {
    if (!signable.includes(e.field)) {
      return NextResponse.json({ error: `edit.field ${e.field} is not signable` }, { status: 400 });
    }
    if (seen.has(e.field)) {
      return NextResponse.json(
        { error: `Duplicate edit entry for field ${e.field}` },
        { status: 400 },
      );
    }
    seen.add(e.field);
    if (e.before !== readField(draft, e.field)) {
      return NextResponse.json(
        {
          error: `edit.before for ${e.field} does not match the current draft text (stale draft?)`,
        },
        { status: 400 },
      );
    }
    if (e.after !== readField(final, e.field)) {
      return NextResponse.json(
        { error: `edit.after for ${e.field} does not match the submitted note` },
        { status: 400 },
      );
    }
  }
  for (const field of signable) {
    if (!seen.has(field) && readField(final, field) !== readField(draft, field)) {
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
 * Verification chain:
 *   1. sha256(payload) === payloadHashHex
 *   2. sha256(payload) === assertion.challengeHashHex (when present)
 *   3. note matches TherapyNoteV1Schema
 *   4. edits[].before/after consistent with draft + final note
 *   5. If the account has any registered credential, the assertion is
 *      REQUIRED and is cryptographically verified against the matched
 *      credential's public key (signature + challenge binding + rpIdHash
 *      + signCount monotonicity) via verifyNoteSigningAssertion. See
 *      apps/web/lib/webauthn-verify.ts.
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
    select: {
      psychologistId: true,
      status: true,
      kind: true,
      psychologist: { select: { vertical: true } },
    },
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
  // INTAKE notes sign their own shape; TREATMENT + REVIEW share SOAP;
  // a doctor's session signs a MedicalEncounterNoteV1 (Sprint DV3).
  const signableKind: SignableKind = signableKindFor(session.kind, session.psychologist.vertical);
  const noteSchema =
    signableKind === 'INTAKE'
      ? IntakeNoteV1Schema
      : signableKind === 'MEDICAL'
        ? MedicalEncounterNoteV1Schema
        : TherapyNoteV1Schema;
  const signableFields = SIGNABLE_FIELDS_BY_KIND[signableKind];

  // Sprint 18 → 33 — once the therapist has registered ≥1 platform
  // authenticator, the assertion is REQUIRED, its credentialId must
  // match a known non-revoked row, AND its signature must verify
  // cryptographically against that credential's stored public key
  // (Sprint 33 closed the V1.2 gap — credentialId alone is not a
  // secret). Accounts with no credential registered keep the
  // historical optional-assertion behaviour so dev / mock flows and
  // not-yet-enrolled pilot therapists don't break.
  const activeCredentials = await prisma.webAuthnCredential.findMany({
    where: { psychologistId: auth.value.psychologistId, revokedAt: null },
    select: { id: true, credentialId: true, publicKey: true, signCount: true },
  });
  let credentialBump: { id: string; newSignCount: number } | null = null;
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
    const rpId = process.env['WEBAUTHN_RP_ID'] ?? new URL(req.url).hostname;
    const verification = verifyNoteSigningAssertion({
      publicKeySpkiB64Url: matched.publicKey,
      authenticatorDataB64Url: input.value.assertion.authenticatorData,
      clientDataJsonB64Url: input.value.assertion.clientDataJSON,
      signatureB64Url: input.value.assertion.signature,
      expectedChallengeHashHex: recomputed,
      expectedRpId: rpId,
      allowedOrigins: resolveAllowedOrigins(),
      storedSignCount: matched.signCount,
    });
    if (!verification.ok) {
      return NextResponse.json(
        { error: `WebAuthn assertion verification failed: ${verification.reason}` },
        { status: 401 },
      );
    }
    credentialBump = { id: matched.id, newSignCount: verification.newSignCount };
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

  // Sprint 49 — parse both draft + final note against the kind-keyed
  // schema. An INTAKE session whose draft happens to validate against
  // TherapyNoteV1 (or vice-versa) would still be wrong shape for sign-off.
  const draftContent = noteSchema.parse(draft.content) as SignedNoteContent;
  const finalNote = noteSchema.parse(input.value.note) as SignedNoteContent;
  // Zod default([]) — runtime is [], TS sees optional under
  // exactOptionalPropertyTypes: false. Coalesce defensively.
  const edits = input.value.edits ?? [];
  const editsError = validateEdits(draftContent, finalNote, edits, signableFields);
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
    const auditBase = {
      actorType: 'PSYCHOLOGIST' as const,
      actorPsychologistId: auth.value.psychologistId,
      targetType: 'TherapyNote',
      targetId: note.id,
      metadata: {
        ...auditMetadataFromRequest(req),
        sessionId,
        draftId: draft.id,
        editedFields: edits.map((e) => e.field),
        payloadHashHex: recomputed,
        webauthnUsed: input.value.assertion !== undefined,
        webauthnEnforced: credentialBump !== null,
        // Sprint 49 — disaggregate intake vs treatment (vs medical) in the
        // signed-note audit trail so My Practice can split them.
        kind: signableKind,
      },
    };
    // Sprint DV3 — medical encounter notes audit ENCOUNTER_NOTE_SIGNED;
    // therapy notes keep NOTE_SIGNED. Two literal calls so the audit
    // chaos-test regex picks both action strings up.
    if (signableKind === 'MEDICAL') {
      await writeAudit({ ...auditBase, action: 'ENCOUNTER_NOTE_SIGNED' }, tx);
    } else {
      await writeAudit({ ...auditBase, action: 'NOTE_SIGNED' }, tx);
    }
    if (credentialBump !== null) {
      // Persist the authenticator's reported counter (not a blind +1) so
      // the next sign can detect a rollback / cloned authenticator.
      await tx.webAuthnCredential.update({
        where: { id: credentialBump.id },
        data: { lastUsedAt: new Date(), signCount: credentialBump.newSignCount },
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
