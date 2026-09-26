import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireScribeDoctor, scribeErrorResponse } from '@/lib/scribe-workspace-auth';
import {
  getScribeRecord,
  updateScribeRecord,
  deleteScribeRecord,
} from '@/lib/scribe-workspace-store';
import {
  InstructionsBodySchema,
  InstructionsReviewInputSchema,
  reviewedInstructionLines,
} from '@/lib/scribe-instructions-schema';
import { assertInstructionSourceCurrent } from '@/lib/scribe-instructions-source';
import { boundedDocumentJson, ScribeDocumentError } from '@/lib/scribe-document-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
export async function PATCH(req: NextRequest, context: Context) {
  const auth = await requireScribeDoctor(req);
  if (!auth.ok) return auth.response;
  try {
    const input = InstructionsReviewInputSchema.safeParse(await boundedDocumentJson(req));
    if (!input.success)
      throw new ScribeDocumentError(
        400,
        'Review both clinical accuracy and language before confirming these instructions.',
      );
    const { id } = await context.params;
    const psychologistId = auth.value.psychologistId;
    const scope = { psychologistId, kind: 'instructions' as const };
    const record = await getScribeRecord(scope, id, InstructionsBodySchema);
    if (!record?.sessionId || !record.clientId)
      throw new ScribeDocumentError(404, 'Instructions not found.');
    const lines = reviewedInstructionLines(record.body, input.data.lines);
    if (!lines)
      throw new ScribeDocumentError(
        409,
        'Keep every source row, medicine name and number unchanged. Treatment changes belong in the prescription and need a new signature.',
      );
    const sessionId = record.sessionId;
    const clientId = record.clientId;
    const updated = await updateScribeRecord(
      {
        ...scope,
        guard: (tx) =>
          assertInstructionSourceCurrent(
            psychologistId,
            sessionId,
            clientId,
            record.body.sourceHash,
            tx,
          ),
      },
      id,
      input.data.revision,
      {
        ...record.body,
        lines,
        status: 'reviewed' as const,
        clinicalReviewed: true,
        languageReviewed: true,
        reviewedAt: new Date().toISOString(),
        reviewedBy: psychologistId,
      },
    );
    return NextResponse.json(
      { record: { ...updated, sourceCurrent: true } },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return scribeErrorResponse(error);
  }
}

export async function DELETE(req: NextRequest, context: Context) {
  const auth = await requireScribeDoctor(req);
  if (!auth.ok) return auth.response;
  try {
    const input = z
      .object({ revision: z.number().int().positive() })
      .strict()
      .safeParse(await boundedDocumentJson(req));
    if (!input.success) throw new ScribeDocumentError(400, 'A record revision is required.');
    await deleteScribeRecord(
      { psychologistId: auth.value.psychologistId, kind: 'instructions' },
      (await context.params).id,
      input.data.revision,
    );
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return scribeErrorResponse(error);
  }
}
