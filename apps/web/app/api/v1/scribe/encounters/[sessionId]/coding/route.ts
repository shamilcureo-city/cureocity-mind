import { createHash } from 'node:crypto';
import {
  DifferentialDiagnosisV1Schema,
  MedicalEncounterNoteV1Schema,
  type MedicalEncounterNoteV1,
} from '@cureocity/contracts';
import type { Prisma } from '@prisma/client';
import { NextResponse, type NextRequest } from 'next/server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { SIGNABLE_FIELDS_BY_KIND } from '@/lib/note-edit-fields';
import { lockActiveClientForSession } from '@/lib/phi-write-lock';
import { prisma } from '@/lib/prisma';
import {
  ScribeCodingBodySchema,
  ScribeCodingSaveSchema,
  scribeCodingNoteIdentity,
  scribeCodingSuggestions,
  type ScribeCodingBody,
  type ScribeCodingResponse,
} from '@/lib/scribe-coding';
import { boundedDocumentJson } from '@/lib/scribe-document-errors';
import { canonicalJson } from '@/lib/sign-note-payload';
import {
  requireScribeDoctor,
  scribeErrorResponse,
  ScribeWorkspaceError,
} from '@/lib/scribe-workspace-auth';
import {
  createScribeRecord,
  getScribeRecord,
  updateScribeRecord,
  type ScribeRecord,
} from '@/lib/scribe-workspace-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ sessionId: string }> };
const headers = { 'Cache-Control': 'private, no-store' };
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
const recordId = (sessionId: string): string => `scribe-coding-${hash(sessionId)}`;
type Source = {
  clientId: string;
  draft: ScribeCodingResponse['draft'];
  signed: boolean;
  signedNoteHash: string | null;
};

/** Follow the common Client -> practitioner -> Session -> NoteDraft -> TherapyNote order. */
async function lockedSource(
  tx: Prisma.TransactionClient,
  psychologistId: string,
  sessionId: string,
): Promise<Source> {
  const client = await lockActiveClientForSession(tx, sessionId, psychologistId);
  const owners = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "psychologists" WHERE "id" = ${psychologistId}
      AND "vertical" = 'DOCTOR' AND "status" = 'ACTIVE' AND "deletedAt" IS NULL FOR SHARE
  `;
  if (!owners[0]) throw new ScribeWorkspaceError(403, 'The doctor workspace is no longer active.');
  const sessions = await tx.$queryRaw<
    Array<{ clientId: string; psychologistId: string; status: string; clientStatus: string }>
  >`
    SELECT s."clientId", s."psychologistId", s."status", c."status" AS "clientStatus"
    FROM "sessions" s JOIN "clients" c ON c."id" = s."clientId"
    WHERE s."id" = ${sessionId} FOR UPDATE OF s
  `;
  const session = sessions[0];
  if (
    !session ||
    session.clientId !== client.id ||
    session.psychologistId !== psychologistId ||
    session.clientStatus !== 'ACTIVE'
  )
    throw new ScribeWorkspaceError(404, 'Encounter not found or no longer available.');
  if (session.status !== 'COMPLETED')
    throw new ScribeWorkspaceError(409, 'Wait for the encounter note to finish saving.');
  const drafts = await tx.$queryRaw<Array<{ id: string; status: string; content: unknown }>>`
    SELECT "id", "status", "content" FROM "note_drafts"
    WHERE "sessionId" = ${sessionId} FOR UPDATE
  `;
  const draft = drafts[0];
  const parsed = MedicalEncounterNoteV1Schema.safeParse(draft?.content);
  if (!draft || draft.status !== 'COMPLETED' || !parsed.success)
    throw new ScribeWorkspaceError(409, 'A saved medical note is required before coding review.');
  const notes = await tx.$queryRaw<Array<{ signedAt: Date | null; content: unknown }>>`
    SELECT "signedAt", "content" FROM "therapy_notes" WHERE "sessionId" = ${sessionId} FOR UPDATE
  `;
  const signed = Boolean(notes[0]?.signedAt);
  let signedNoteHash: string | null = null;
  if (signed) {
    const signedNote = MedicalEncounterNoteV1Schema.safeParse(notes[0]?.content);
    if (!signedNote.success)
      throw new ScribeWorkspaceError(409, 'The signed medical note could not be read.');
    signedNoteHash = hash(scribeCodingNoteIdentity(signedNote.data));
  }
  return {
    clientId: client.id,
    draft: {
      id: draft.id,
      hash: hash(canonicalJson({ id: draft.id, content: parsed.data })),
      content: parsed.data,
    },
    signed,
    signedNoteHash,
  };
}

function assertSaveSource(source: Source, draftHash: string, working: MedicalEncounterNoteV1) {
  if (source.signed)
    throw new ScribeWorkspaceError(
      409,
      'This encounter is signed. Its coding worksheet is frozen.',
    );
  if (source.draft.hash !== draftHash)
    throw new ScribeWorkspaceError(409, 'The saved draft changed. Reload before saving coding.');
  const editable = new Set<string>(SIGNABLE_FIELDS_BY_KIND.MEDICAL);
  const provenance = (note: MedicalEncounterNoteV1) =>
    Object.fromEntries(Object.entries(note).filter(([key]) => !editable.has(key)));
  if (canonicalJson(provenance(source.draft.content)) !== canonicalJson(provenance(working)))
    throw new ScribeWorkspaceError(
      409,
      'Encounter metadata and source references cannot be changed here.',
    );
}

function responseBody(
  source: Source,
  record: ScribeRecord<ScribeCodingBody> | null,
  suggestions: ScribeCodingResponse['suggestions'] = [],
): ScribeCodingResponse {
  return {
    draft: source.draft,
    signed: source.signed,
    signedNoteHash: source.signedNoteHash,
    record,
    sourceCurrent:
      record === null
        ? null
        : record.body.draftId === source.draft.id &&
          record.body.draftHash === source.draft.hash &&
          (!source.signed || record.body.reviewedNoteHash === source.signedNoteHash),
    suggestions,
  };
}

async function cachedSuggestions(
  tx: Prisma.TransactionClient,
  sessionId: string,
  canReadAnalysis: boolean,
): Promise<ScribeCodingResponse['suggestions']> {
  // Manual coding does not require permission to disclose AI clinical analysis.
  if (!canReadAnalysis) return [];
  const cached = await tx.differential.findUnique({
    where: { sessionId },
    select: { status: true, body: true },
  });
  const differential = DifferentialDiagnosisV1Schema.safeParse(cached?.body);
  return scribeCodingSuggestions(
    cached?.status === 'COMPLETED' && differential.success ? differential.data : null,
  );
}

export async function GET(req: NextRequest, { params }: Context): Promise<NextResponse> {
  const auth = await requireScribeDoctor(req, 'MEDICAL_DOCUMENTATION');
  if (!auth.ok) {
    auth.response.headers.set('Cache-Control', headers['Cache-Control']);
    return auth.response;
  }
  const { sessionId } = await params;
  try {
    const body = await prisma.$transaction(async (tx) => {
      const source = await lockedSource(tx, auth.value.psychologistId, sessionId);
      const record = await getScribeRecord(
        {
          psychologistId: auth.value.psychologistId,
          kind: 'coding',
          clientId: source.clientId,
          sessionId,
        },
        recordId(sessionId),
        ScribeCodingBodySchema,
        tx,
      );
      const suggestions = await cachedSuggestions(
        tx,
        sessionId,
        auth.value.user.capabilities?.includes('CLINICAL_ANALYSIS') ?? false,
      );
      await writeAudit(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: auth.value.psychologistId,
          action: 'NOTE_DRAFT_VIEWED',
          targetType: 'NoteDraft',
          targetId: source.draft.id,
          metadata: {
            ...auditMetadataFromRequest(req),
            sessionId,
            source: 'SCRIBE_CODING_WORKSHEET',
          },
        },
        tx,
      );
      return responseBody(source, record, suggestions);
    });
    return NextResponse.json(body, { headers });
  } catch (error) {
    const response = scribeErrorResponse(error);
    response.headers.set('Cache-Control', headers['Cache-Control']);
    return response;
  }
}

export async function PUT(req: NextRequest, { params }: Context): Promise<NextResponse> {
  const auth = await requireScribeDoctor(req, 'MEDICAL_DOCUMENTATION');
  if (!auth.ok) {
    auth.response.headers.set('Cache-Control', headers['Cache-Control']);
    return auth.response;
  }
  try {
    const input = ScribeCodingSaveSchema.safeParse(await boundedDocumentJson(req));
    if (!input.success)
      throw new ScribeWorkspaceError(
        400,
        'Check the worksheet entries and review state before saving.',
      );
    const { sessionId } = await params;
    const psychologistId = auth.value.psychologistId;
    let source = await prisma.$transaction((tx) => lockedSource(tx, psychologistId, sessionId));
    let suggestions: ScribeCodingResponse['suggestions'] = [];
    assertSaveSource(source, input.data.draftHash, input.data.workingNote);
    const reviewed = input.data.worksheet.status === 'reviewed';
    const body = ScribeCodingBodySchema.parse({
      worksheet: input.data.worksheet,
      draftId: source.draft.id,
      draftHash: source.draft.hash,
      reviewedNoteHash: reviewed ? hash(scribeCodingNoteIdentity(input.data.workingNote)) : null,
      reviewedAt: reviewed ? new Date().toISOString() : null,
      reviewedBy: reviewed ? psychologistId : null,
    });
    const scope = {
      psychologistId,
      kind: 'coding' as const,
      clientId: source.clientId,
      sessionId,
      requireUnsigned: true,
      guard: async (tx: Prisma.TransactionClient) => {
        const current = await lockedSource(tx, psychologistId, sessionId);
        assertSaveSource(current, input.data.draftHash, input.data.workingNote);
        suggestions = await cachedSuggestions(
          tx,
          sessionId,
          auth.value.user.capabilities?.includes('CLINICAL_ANALYSIS') ?? false,
        );
        source = current;
      },
    };
    const record =
      input.data.expectedRevision === 0
        ? await createScribeRecord(scope, body, recordId(sessionId))
        : await updateScribeRecord(scope, recordId(sessionId), input.data.expectedRevision, body);
    return NextResponse.json(responseBody(source, record, suggestions), { headers });
  } catch (error) {
    const response = scribeErrorResponse(error);
    response.headers.set('Cache-Control', headers['Cache-Control']);
    return response;
  }
}
