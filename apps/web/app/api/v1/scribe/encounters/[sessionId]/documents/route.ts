import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  requireScribeDoctor,
  scribeErrorResponse,
  ScribeWorkspaceError,
} from '@/lib/scribe-workspace-auth';
import { createScribeRecord, getScribeRecord } from '@/lib/scribe-workspace-store';
import { boundedDocumentJson } from '@/lib/scribe-document-errors';
import {
  SCRIBE_CONSULTATION_DOCUMENT_MAX_PACKETS,
  ScribeConsultationDocumentPacketBodySchema,
  ScribeConsultationDocumentsCreateSchema,
} from '@/lib/scribe-consultation-documents';
import {
  assertConsultationDocumentSource,
  auditConsultationDocumentRead,
  consultationDocumentPacketId,
  consultationDocumentRequestHash,
  consultationDocumentResponse,
  draftConsultationDocuments,
  readLockedConsultationDocumentSource,
} from '@/lib/scribe-consultation-document-source';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ sessionId: string }> };
const headers = { 'Cache-Control': 'private, no-store' };
function failure(error: unknown) {
  const response = scribeErrorResponse(error);
  response.headers.set('Cache-Control', headers['Cache-Control']);
  return response;
}

export async function GET(req: NextRequest, { params }: Context): Promise<NextResponse> {
  const auth = await requireScribeDoctor(req, 'MEDICAL_DOCUMENTATION');
  if (!auth.ok) {
    auth.response.headers.set('Cache-Control', headers['Cache-Control']);
    return auth.response;
  }
  try {
    const { sessionId } = await params;
    const owner = auth.value.psychologistId;
    const body = await prisma.$transaction(async (tx) => {
      const source = await readLockedConsultationDocumentSource(tx, owner, sessionId);
      const response = await consultationDocumentResponse(tx, owner, sessionId, source);
      await auditConsultationDocumentRead(tx, req, owner, source.clientId, sessionId);
      return response;
    });
    return NextResponse.json(body, { headers });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(req: NextRequest, { params }: Context): Promise<NextResponse> {
  const auth = await requireScribeDoctor(req, 'MEDICAL_DOCUMENTATION');
  if (!auth.ok) {
    auth.response.headers.set('Cache-Control', headers['Cache-Control']);
    return auth.response;
  }
  try {
    const parsed = ScribeConsultationDocumentsCreateSchema.safeParse(
      await boundedDocumentJson(req),
    );
    if (!parsed.success)
      throw new ScribeWorkspaceError(
        400,
        'Choose unique document types and a valid signed source.',
      );
    const input = parsed.data;
    const { sessionId } = await params;
    const owner = auth.value.psychologistId;
    const id = consultationDocumentPacketId(owner, sessionId, input.operationId);
    const requestHash = consultationDocumentRequestHash(input);
    const preflight = await prisma.$transaction(async (tx) => {
      const source = await readLockedConsultationDocumentSource(tx, owner, sessionId);
      const existing = await getScribeRecord(
        { psychologistId: owner, kind: 'documents', clientId: source.clientId, sessionId },
        id,
        ScribeConsultationDocumentPacketBodySchema,
        tx,
      );
      if (existing) {
        if (
          existing.body.requestHash !== requestHash ||
          existing.body.operationId !== input.operationId
        )
          throw new ScribeWorkspaceError(
            409,
            'This create request already belongs to different document drafts.',
          );
        await auditConsultationDocumentRead(tx, req, owner, source.clientId, sessionId, {
          packetId: id,
          revision: existing.revision,
        });
        return {
          source,
          replay: await consultationDocumentResponse(tx, owner, sessionId, source),
          body: null,
        };
      }
      return { source, replay: null, body: draftConsultationDocuments(source, input) };
    });
    if (preflight.replay) return NextResponse.json(preflight.replay, { headers });
    try {
      await createScribeRecord(
        {
          psychologistId: owner,
          kind: 'documents',
          clientId: preflight.source.clientId,
          sessionId,
          guard: async (tx) => {
            const source = await readLockedConsultationDocumentSource(tx, owner, sessionId);
            assertConsultationDocumentSource(source, input.expectedSourceHash);
            const count = await tx.scribeWorkspaceRecord.count({
              where: {
                psychologistId: owner,
                kind: 'documents',
                clientId: source.clientId,
                sessionId,
              },
            });
            if (count >= SCRIBE_CONSULTATION_DOCUMENT_MAX_PACKETS)
              throw new ScribeWorkspaceError(
                409,
                'This encounter already has ten document packets. Its saved history has been preserved.',
              );
          },
        },
        preflight.body!,
        id,
      );
    } catch (error) {
      // Concurrent identical requests may race the primary key; return the one persisted packet.
      if (!(error instanceof ScribeWorkspaceError) || error.status !== 409) throw error;
      const replay = await prisma.$transaction(async (tx) => {
        const source = await readLockedConsultationDocumentSource(tx, owner, sessionId);
        const existing = await getScribeRecord(
          { psychologistId: owner, kind: 'documents', clientId: source.clientId, sessionId },
          id,
          ScribeConsultationDocumentPacketBodySchema,
          tx,
        );
        if (
          !existing ||
          existing.body.requestHash !== requestHash ||
          existing.body.operationId !== input.operationId
        )
          throw error;
        await auditConsultationDocumentRead(tx, req, owner, source.clientId, sessionId, {
          packetId: id,
          revision: existing.revision,
        });
        return consultationDocumentResponse(tx, owner, sessionId, source);
      });
      return NextResponse.json(replay, { headers });
    }
    const response = await prisma.$transaction(async (tx) => {
      const source = await readLockedConsultationDocumentSource(tx, owner, sessionId);
      return consultationDocumentResponse(tx, owner, sessionId, source);
    });
    return NextResponse.json(response, { status: 201, headers });
  } catch (error) {
    return failure(error);
  }
}
