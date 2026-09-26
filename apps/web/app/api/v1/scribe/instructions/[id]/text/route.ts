import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { lockActiveClientForSession } from '@/lib/phi-write-lock';
import { requireScribeDoctor, scribeErrorResponse } from '@/lib/scribe-workspace-auth';
import { getScribeRecord } from '@/lib/scribe-workspace-store';
import {
  InstructionsBodySchema,
  INSTRUCTION_LANGUAGES,
  instructionWordingPreservesFacts,
} from '@/lib/scribe-instructions-schema';
import { assertInstructionSourceCurrent } from '@/lib/scribe-instructions-source';
import { ScribeDocumentError } from '@/lib/scribe-document-errors';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Explicit download only: no SMS/email, public URL, or automatic share side effect. */
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireScribeDoctor(req);
  if (!auth.ok) return auth.response;
  const sharing = await requireScribeDoctor(req, 'PATIENT_SHARING');
  if (!sharing.ok) return sharing.response;
  try {
    const psychologistId = auth.value.psychologistId;
    const record = await getScribeRecord(
      { psychologistId, kind: 'instructions' },
      (await context.params).id,
      InstructionsBodySchema,
    );
    if (!record?.sessionId || !record.clientId)
      throw new ScribeDocumentError(404, 'Instructions not found.');
    const body = record.body;
    if (
      body.status !== 'reviewed' ||
      !body.clinicalReviewed ||
      !body.languageReviewed ||
      !body.reviewedAt ||
      body.lines.some((line) => !instructionWordingPreservesFacts(line, line.text))
    ) {
      throw new ScribeDocumentError(
        409,
        'The doctor must review clinical accuracy and language before downloading.',
      );
    }
    const sessionId = record.sessionId;
    const clientId = record.clientId;
    await prisma.$transaction(async (tx) => {
      await lockActiveClientForSession(tx, sessionId, psychologistId);
      await tx.$queryRaw`SELECT "id" FROM "sessions" WHERE "id" = ${sessionId} FOR UPDATE`;
      await assertInstructionSourceCurrent(
        psychologistId,
        sessionId,
        clientId,
        body.sourceHash,
        tx,
      );
      // Confirm the reviewed record itself has not been deleted/replaced during the source check.
      const fresh = await tx.scribeWorkspaceRecord.findFirst({
        where: {
          id: record.id,
          psychologistId,
          revision: record.revision,
          kind: 'instructions',
          clientId,
          sessionId,
        },
        select: { id: true },
      });
      if (!fresh)
        throw new ScribeDocumentError(409, 'Instructions changed. Reload before downloading.');
      await writeAudit(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: psychologistId,
          action: 'CLIENT_VIEWED',
          targetType: 'Client',
          targetId: clientId,
          metadata: {
            ...auditMetadataFromRequest(req),
            surface: 'scribe_instructions_download',
            recordId: record.id,
            revision: record.revision,
            sessionId,
          },
        },
        tx,
      );
    });
    const text = [
      'Doctor-reviewed patient instructions',
      `Patient reference: ${clientId}`,
      `Encounter reference: ${sessionId}`,
      `Advice and follow-up language: ${INSTRUCTION_LANGUAGES[body.language]}`,
      'Medication instructions remain exactly as signed (not translated).',
      `Signed source: ${body.signedAt}`,
      `Reviewed: ${body.reviewedAt}`,
      '',
      ...body.lines.map(
        (line) =>
          `${line.kind.toUpperCase()}\n${line.text}${line.text !== line.source ? `\nSigned wording: ${line.source}` : ''}\n`,
      ),
      'Based on the signed prescription. Patient wording does not replace the original prescription; treatment changes require a newly signed prescription.',
    ].join('\n');
    return new NextResponse(text, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': 'attachment; filename="reviewed-patient-instructions.txt"',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return scribeErrorResponse(error);
  }
}
