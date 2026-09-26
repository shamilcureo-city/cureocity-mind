import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import {
  requireScribeDoctor,
  scribeErrorResponse,
  ScribeWorkspaceError,
} from '@/lib/scribe-workspace-auth';
import { getScribeRecord } from '@/lib/scribe-workspace-store';
import { hasUnresolvedScribeTemplateFields } from '@/lib/scribe-doctor-templates';
import {
  SCRIBE_CONSULTATION_DOCUMENT_LABELS,
  ScribeConsultationDocumentPacketBodySchema,
  ScribeConsultationDocumentTypeSchema,
} from '@/lib/scribe-consultation-documents';
import {
  assertConsultationDocumentSource,
  auditConsultationDocumentRead,
  readLockedConsultationDocumentSource,
} from '@/lib/scribe-consultation-document-source';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const cache = 'private, no-store';
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; documentId: string }> },
): Promise<NextResponse> {
  const auth = await requireScribeDoctor(req, 'MEDICAL_DOCUMENTATION');
  if (!auth.ok) {
    auth.response.headers.set('Cache-Control', cache);
    return auth.response;
  }
  const sharing = await requireScribeDoctor(req, 'PATIENT_SHARING');
  if (!sharing.ok) {
    sharing.response.headers.set('Cache-Control', cache);
    return sharing.response;
  }
  try {
    const { id, documentId } = await params;
    const type = ScribeConsultationDocumentTypeSchema.safeParse(documentId);
    const revision = z.coerce
      .number()
      .int()
      .positive()
      .safeParse(req.nextUrl.searchParams.get('revision'));
    if (!type.success || !revision.success)
      throw new ScribeWorkspaceError(400, 'Choose a reviewed document revision to download.');
    const owner = auth.value.psychologistId;
    const scope = { psychologistId: owner, kind: 'documents' as const };
    const initial = await getScribeRecord(scope, id, ScribeConsultationDocumentPacketBodySchema);
    if (!initial?.clientId || !initial.sessionId)
      throw new ScribeWorkspaceError(404, 'Document not found.');
    const { clientId, sessionId } = initial;
    const text = await prisma.$transaction(async (tx) => {
      const source = await readLockedConsultationDocumentSource(tx, owner, sessionId);
      const packet = await getScribeRecord(
        { ...scope, clientId, sessionId },
        id,
        ScribeConsultationDocumentPacketBodySchema,
        tx,
      );
      if (!packet || packet.revision !== revision.data)
        throw new ScribeWorkspaceError(
          409,
          'This packet changed. Reload and review before downloading.',
        );
      assertConsultationDocumentSource(source, packet.body.sourceHash);
      const document = packet.body.documents.find((item) => item.id === type.data);
      if (
        !document ||
        document.status !== 'reviewed' ||
        document.reviewedBy !== owner ||
        !document.reviewedAt ||
        hasUnresolvedScribeTemplateFields(document.additions)
      )
        throw new ScribeWorkspaceError(
          409,
          'Review this exact document before downloading its draft.',
        );
      await auditConsultationDocumentRead(tx, req, owner, clientId, sessionId, {
        packetId: packet.id,
        documentId: document.id,
        revision: packet.revision,
      });
      return [
        'DRAFT ONLY — NOT A SIGNED OR ISSUED DOCUMENT',
        ...(document.type === 'medical_certificate'
          ? ['MEDICAL CERTIFICATE DRAFT — NOT VALID FOR ISSUE']
          : []),
        SCRIBE_CONSULTATION_DOCUMENT_LABELS[document.type],
        `Patient reference: ${clientId}`,
        `Encounter reference: ${sessionId}`,
        `Signed source note: ${packet.body.noteId}`,
        `Source signed at: ${packet.body.signedAt}`,
        `Document reviewed at: ${document.reviewedAt}`,
        '',
        'UNCHANGED EXCERPTS FROM THE SIGNED SOURCE',
        ...(document.sourceSections.length
          ? document.sourceSections.map((section) => `${section.label}\n${section.text}\n`)
          : ['No medical fitness, incapacity, examination or leave statement has been inferred.']),
        '',
        'DOCTOR-ENTERED ADDITIONS — NOT COVERED BY THE SOURCE NOTE SIGNATURE',
        document.additions || '(No additions entered.)',
        '',
        'This reviewed draft has not been separately signed, issued, sent or shared by Cureocity. It does not replace the signed clinical note or prescription.',
        ...(document.type === 'medical_certificate'
          ? [
              'Certificate particulars and any clinical assertions require independent clinician completion and a separate issuance/signature process. NOT VALID FOR ISSUE.',
            ]
          : []),
      ].join('\n');
    });
    return new NextResponse(text, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${type.data}-draft.txt"`,
        'Cache-Control': cache,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    const response = scribeErrorResponse(error);
    response.headers.set('Cache-Control', cache);
    return response;
  }
}
