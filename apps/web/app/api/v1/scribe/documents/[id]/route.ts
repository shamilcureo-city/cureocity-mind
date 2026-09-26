import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  requireScribeDoctor,
  scribeErrorResponse,
  ScribeWorkspaceError,
} from '@/lib/scribe-workspace-auth';
import { getScribeRecord, updateScribeRecord } from '@/lib/scribe-workspace-store';
import { boundedDocumentJson } from '@/lib/scribe-document-errors';
import { hasUnresolvedScribeTemplateFields } from '@/lib/scribe-doctor-templates';
import {
  ScribeConsultationDocumentPacketBodySchema,
  ScribeConsultationDocumentUpdateSchema,
} from '@/lib/scribe-consultation-documents';
import {
  assertConsultationDocumentSource,
  boundedConsultationDocumentBody,
  consultationDocumentResponse,
  readLockedConsultationDocumentSource,
} from '@/lib/scribe-consultation-document-source';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireScribeDoctor(req, 'MEDICAL_DOCUMENTATION');
  if (!auth.ok) {
    auth.response.headers.set('Cache-Control', headers['Cache-Control']);
    return auth.response;
  }
  try {
    const input = ScribeConsultationDocumentUpdateSchema.safeParse(await boundedDocumentJson(req));
    if (!input.success)
      throw new ScribeWorkspaceError(400, 'Check the document text, review choice, and revision.');
    if (input.data.reviewed && hasUnresolvedScribeTemplateFields(input.data.additions))
      throw new ScribeWorkspaceError(
        409,
        'Complete or remove every template prompt before reviewing this document.',
      );
    const owner = auth.value.psychologistId;
    const { id } = await params;
    const scope = { psychologistId: owner, kind: 'documents' as const };
    const record = await getScribeRecord(scope, id, ScribeConsultationDocumentPacketBodySchema);
    if (
      !record?.clientId ||
      !record.sessionId ||
      !record.body.documents.some((document) => document.id === input.data.documentId)
    )
      throw new ScribeWorkspaceError(404, 'Document not found.');
    // Derive the replacement only from the exact version the caller reviewed.
    // A predicted future revision must not make stale sibling documents writable.
    if (record.revision !== input.data.revision)
      throw new ScribeWorkspaceError(
        409,
        'This packet changed. Reload before editing or reviewing.',
      );
    const { clientId, sessionId } = record;
    const body = ScribeConsultationDocumentPacketBodySchema.parse({
      ...record.body,
      documents: record.body.documents.map((document) =>
        document.id !== input.data.documentId
          ? document
          : {
              ...document,
              additions: input.data.additions,
              status: input.data.reviewed ? 'reviewed' : 'draft',
              reviewedAt: input.data.reviewed ? new Date().toISOString() : null,
              reviewedBy: input.data.reviewed ? owner : null,
            },
      ),
    });
    boundedConsultationDocumentBody(body);
    await updateScribeRecord(
      {
        ...scope,
        clientId,
        sessionId,
        guard: async (tx) =>
          assertConsultationDocumentSource(
            await readLockedConsultationDocumentSource(tx, owner, sessionId),
            body.sourceHash,
          ),
      },
      id,
      input.data.revision,
      body,
    );
    const response = await prisma.$transaction(async (tx) => {
      const source = await readLockedConsultationDocumentSource(tx, owner, sessionId);
      return consultationDocumentResponse(tx, owner, sessionId, source);
    });
    return NextResponse.json(response, { headers });
  } catch (error) {
    const response = scribeErrorResponse(error);
    response.headers.set('Cache-Control', headers['Cache-Control']);
    return response;
  }
}
