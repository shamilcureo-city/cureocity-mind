import { createHash } from 'node:crypto';
import {
  MedicalEncounterNoteV1Schema,
  RxPadV1Schema,
  type MedicalEncounterNoteV1,
  type RxPadV1,
} from '@cureocity/contracts';
import type { Prisma } from '@prisma/client';
import { auditMetadataFromRequest, writeAudit } from './audit';
import { lockActiveClientForSession } from './phi-write-lock';
import { canonicalJson } from './sign-note-payload';
import { ScribeWorkspaceError } from './scribe-workspace-auth';
import { listScribeRecords } from './scribe-workspace-store';
import {
  SCRIBE_CONSULTATION_DOCUMENT_MAX_PACKETS,
  ScribeConsultationDocumentPacketBodySchema,
  ScribeConsultationDocumentsResponseSchema,
  type ScribeConsultationDocument,
  type ScribeConsultationDocumentPacketBody,
  type ScribeConsultationDocumentSource,
  type ScribeConsultationDocumentsCreate,
  type ScribeConsultationDocumentsResponse,
} from './scribe-consultation-documents';

export type ConsultationDocumentSource = {
  clientId: string;
  view: ScribeConsultationDocumentSource;
  note: MedicalEncounterNoteV1 | null;
  rx: RxPadV1 | null;
};
export const consultationDocumentHash = (value: unknown): string =>
  createHash('sha256').update(canonicalJson(value)).digest('hex');
export const consultationDocumentPacketId = (
  owner: string,
  sessionId: string,
  operationId: string,
): string => `scribe-docs-${consultationDocumentHash([owner, sessionId, operationId])}`;
export const consultationDocumentRequestHash = (input: ScribeConsultationDocumentsCreate): string =>
  consultationDocumentHash({
    expectedSourceHash: input.expectedSourceHash,
    types: [...input.types].sort(),
  });

/** Lifecycle locks precede all reads, including history when the current note is unsigned. */
export async function readLockedConsultationDocumentSource(
  tx: Prisma.TransactionClient,
  owner: string,
  sessionId: string,
): Promise<ConsultationDocumentSource> {
  const client = await lockActiveClientForSession(tx, sessionId, owner);
  const owners = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "psychologists" WHERE "id" = ${owner}
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
    session.psychologistId !== owner ||
    session.clientStatus !== 'ACTIVE'
  )
    throw new ScribeWorkspaceError(404, 'Encounter not found or no longer available.');
  const notes = await tx.$queryRaw<
    Array<{
      id: string;
      version: string;
      content: unknown;
      rxPad: unknown;
      signedAt: Date | null;
      signedBy: string;
      locked: boolean;
    }>
  >`
    SELECT "id", "version", "content", "rxPad", "signedAt", "signedBy", "locked"
    FROM "therapy_notes" WHERE "sessionId" = ${sessionId} FOR UPDATE
  `;
  const signed = notes[0];
  const signedAt =
    signed?.signedAt instanceof Date && Number.isFinite(signed.signedAt.getTime())
      ? signed.signedAt.toISOString()
      : null;
  const base = { clientId: client.id, note: null, rx: null };
  if (session.status !== 'COMPLETED' || !signed?.locked || signedAt === null)
    return {
      ...base,
      view: { state: 'unsigned', hash: null, noteId: signed?.id ?? null, signedAt },
    };
  const parsed = MedicalEncounterNoteV1Schema.safeParse(signed.content);
  const rx = signed.rxPad === null ? null : RxPadV1Schema.safeParse(signed.rxPad);
  if (signed.signedBy !== owner || !parsed.success || (rx !== null && !rx.success))
    return { ...base, view: { state: 'unavailable', hash: null, noteId: signed.id, signedAt } };
  const sourceHash = consultationDocumentHash({
    sessionId,
    clientId: client.id,
    ...signed,
    signedAt,
  });
  return {
    clientId: client.id,
    note: parsed.data,
    rx: rx?.success ? rx.data : null,
    view: { state: 'ready', hash: sourceHash, noteId: signed.id, signedAt },
  };
}

export function assertConsultationDocumentSource(
  source: ConsultationDocumentSource,
  expectedHash: string,
): void {
  if (source.view.state !== 'ready' || source.view.hash !== expectedHash)
    throw new ScribeWorkspaceError(
      409,
      'The signed source changed or is not locked. Create new drafts from the current signed encounter.',
    );
}

export function boundedConsultationDocumentBody(body: ScribeConsultationDocumentPacketBody): void {
  if (Buffer.byteLength(JSON.stringify(body), 'utf8') > 256 * 1024)
    throw new ScribeWorkspaceError(413, 'These document drafts are too large to save safely.');
}

/** Exact excerpts only. No AI, medical inference, translations or certificate assertions. */
export function draftConsultationDocuments(
  source: ConsultationDocumentSource,
  input: ScribeConsultationDocumentsCreate,
): ScribeConsultationDocumentPacketBody {
  assertConsultationDocumentSource(source, input.expectedSourceHash);
  const note = source.note!;
  const sections = (
    fields: Array<[string, string]>,
  ): ScribeConsultationDocument['sourceSections'] =>
    fields.filter(([, text]) => text.trim()).map(([label, text]) => ({ label, text }));
  const medications =
    source.rx?.meds
      .filter((med) => med.status === 'confirmed')
      .map((med) =>
        [
          med.drug,
          med.strength,
          med.dose && `Dose: ${med.dose}`,
          med.frequency && `Schedule: ${med.frequency}`,
          med.timing && `Timing: ${med.timing}`,
          med.route && `Route: ${med.route}`,
          med.durationDays && `Duration: ${med.durationDays} days`,
        ]
          .filter(Boolean)
          .join(' · '),
      )
      .join('\n') ?? '';
  const body = ScribeConsultationDocumentPacketBodySchema.safeParse({
    version: 1,
    operationId: input.operationId,
    sourceHash: source.view.hash,
    noteId: source.view.noteId,
    signedAt: source.view.signedAt,
    requestHash: consultationDocumentRequestHash(input),
    documents: input.types.map((type) => ({
      id: type,
      type,
      sourceSections:
        type === 'medical_certificate'
          ? []
          : sections([
              ['Signed chief complaint', note.chiefComplaint],
              ...(type === 'referral' ? [['Signed history', note.hpi] as [string, string]] : []),
              ['Signed assessment', note.assessment],
              ['Signed plan', note.plan],
              ...(type === 'patient_summary'
                ? [
                    ['Confirmed signed prescription', medications] as [string, string],
                    ['Signed prescription advice', source.rx?.adviceLines.join('\n') ?? ''] as [
                      string,
                      string,
                    ],
                    [
                      'Signed prescription investigations',
                      source.rx?.investigations.map((item) => item.name).join('\n') ?? '',
                    ] as [string, string],
                    [
                      'Signed prescription follow-up',
                      source.rx?.followUp
                        ? [source.rx.followUp.when, source.rx.followUp.withWhat]
                            .filter(Boolean)
                            .join(' — ')
                        : '',
                    ] as [string, string],
                  ]
                : []),
            ]),
      additions: '',
      status: 'draft',
      reviewedAt: null,
      reviewedBy: null,
    })),
  });
  if (!body.success)
    throw new ScribeWorkspaceError(
      409,
      'The signed source is too large or invalid for a bounded document draft.',
    );
  boundedConsultationDocumentBody(body.data);
  return body.data;
}

export async function consultationDocumentResponse(
  tx: Prisma.TransactionClient,
  owner: string,
  sessionId: string,
  source: ConsultationDocumentSource,
): Promise<ScribeConsultationDocumentsResponse> {
  const records = await listScribeRecords(
    {
      psychologistId: owner,
      kind: 'documents',
      clientId: source.clientId,
      sessionId,
      limit: SCRIBE_CONSULTATION_DOCUMENT_MAX_PACKETS + 1,
    },
    ScribeConsultationDocumentPacketBodySchema,
    tx,
  );
  if (records.length > SCRIBE_CONSULTATION_DOCUMENT_MAX_PACKETS)
    throw new ScribeWorkspaceError(
      503,
      'The document history exceeds the supported view. No history has been omitted.',
    );
  return ScribeConsultationDocumentsResponseSchema.parse({
    source: source.view,
    packets: records.map((record) => ({
      ...record,
      sourceCurrent:
        source.view.state === 'ready' &&
        record.body.sourceHash === source.view.hash &&
        record.body.noteId === source.view.noteId &&
        record.body.signedAt === source.view.signedAt,
    })),
  });
}

export async function auditConsultationDocumentRead(
  tx: Prisma.TransactionClient,
  req: Request,
  owner: string,
  clientId: string,
  sessionId: string,
  extra: { packetId?: string; documentId?: string; revision?: number } = {},
): Promise<void> {
  await writeAudit(
    {
      actorType: 'PSYCHOLOGIST',
      actorPsychologistId: owner,
      action: 'CLIENT_VIEWED',
      targetType: 'Client',
      targetId: clientId,
      metadata: {
        ...auditMetadataFromRequest(req),
        surface: 'scribe_consultation_documents',
        sessionId,
        ...extra,
      },
    },
    tx,
  );
}
