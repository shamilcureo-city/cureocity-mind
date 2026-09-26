import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireScribeDoctor, scribeErrorResponse } from '@/lib/scribe-workspace-auth';
import {
  getScribeRecord,
  updateScribeRecord,
  deleteScribeRecord,
} from '@/lib/scribe-workspace-store';
import {
  ReportBodySchema,
  ReportReviewInputSchema,
  reportSummary,
  reviewReportCandidates,
} from '@/lib/scribe-report-schema';
import { boundedDocumentJson, ScribeDocumentError } from '@/lib/scribe-document-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, context: Context) {
  const auth = await requireScribeDoctor(req);
  if (!auth.ok) return auth.response;
  try {
    const input = ReportReviewInputSchema.safeParse(await boundedDocumentJson(req));
    if (!input.success)
      throw new ScribeDocumentError(
        400,
        'Review the patient identity and original report before confirming all candidate values.',
      );
    const { id } = await context.params;
    const scope = { psychologistId: auth.value.psychologistId, kind: 'report' as const };
    const record = await getScribeRecord(scope, id, ReportBodySchema);
    if (!record) throw new ScribeDocumentError(404, 'Report not found.');
    if (!reviewReportCandidates(record.body, input.data.candidates))
      throw new ScribeDocumentError(
        409,
        'Candidate evidence changed. Reload the report and review again.',
      );
    const updated = await updateScribeRecord(scope, id, input.data.revision, {
      ...record.body,
      candidates: input.data.candidates,
      status: 'confirmed' as const,
      reviewedAt: new Date().toISOString(),
      reviewedBy: auth.value.psychologistId,
    });
    // Confirmation stores reviewed results only; NEVER writes to vitals, diagnoses or medications.
    return NextResponse.json(
      { record: { ...updated, body: reportSummary(updated.body) } },
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
      .parse(await boundedDocumentJson(req));
    await deleteScribeRecord(
      { psychologistId: auth.value.psychologistId, kind: 'report' },
      (await context.params).id,
      input.revision,
    );
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return scribeErrorResponse(error);
  }
}
