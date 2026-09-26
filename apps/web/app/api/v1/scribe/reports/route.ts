import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireScribeDoctor, scribeErrorResponse } from '@/lib/scribe-workspace-auth';
import { listScribeRecords, createScribeRecord } from '@/lib/scribe-workspace-store';
import { ReportBodySchema, reportSummary } from '@/lib/scribe-report-schema';
import {
  readReportUpload,
  validateReportFile,
  extractReport,
} from '@/lib/scribe-report-processing';
import { assertDocumentConsent, documentAiConfig } from '@/lib/scribe-document-ai';
import {
  decodeReportCursor,
  reportListPage,
  REPORT_LIST_PAGE_SIZE,
  ReportListQuerySchema,
} from '@/lib/scribe-report-pagination';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;
const ScopeSchema = z.object({
  clientId: z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/),
  sessionId: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{1,160}$/)
    .optional(),
});
const headers = { 'Cache-Control': 'private, no-store' };
function query(req: NextRequest) {
  return ScopeSchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
}

export async function GET(req: NextRequest) {
  const auth = await requireScribeDoctor(req);
  if (!auth.ok) return auth.response;
  const parsed = ReportListQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: 'Choose a patient.' }, { status: 400 });
  try {
    const { clientId, sessionId, cursor } = parsed.data;
    const records = await listScribeRecords(
      {
        psychologistId: auth.value.psychologistId,
        kind: 'report',
        clientId,
        sessionId,
        limit: REPORT_LIST_PAGE_SIZE + 1,
        page: cursor ? { after: decodeReportCursor(cursor) } : {},
      },
      ReportBodySchema,
    );
    return NextResponse.json(reportListPage(records), { headers });
  } catch (error) {
    return scribeErrorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireScribeDoctor(req);
  if (!auth.ok) return auth.response;
  const parsed = query(req);
  if (!parsed.success) return NextResponse.json({ error: 'Choose a patient.' }, { status: 400 });
  try {
    documentAiConfig();
    const psychologistId = auth.value.psychologistId;
    await assertDocumentConsent(psychologistId, parsed.data.clientId);
    const original = await validateReportFile(await readReportUpload(req));
    // Consent is checked again immediately before disclosure after file parsing.
    await assertDocumentConsent(psychologistId, parsed.data.clientId);
    const body = await extractReport(original, { psychologistId, clientId: parsed.data.clientId });
    const currentAuth = await requireScribeDoctor(req);
    if (!currentAuth.ok) return currentAuth.response;
    const record = await createScribeRecord(
      {
        psychologistId,
        kind: 'report',
        ...parsed.data,
        guard: (tx) => assertDocumentConsent(psychologistId, parsed.data.clientId, tx),
      },
      body,
    );
    return NextResponse.json(
      { record: { ...record, body: reportSummary(record.body) } },
      { status: 201, headers },
    );
  } catch (error) {
    return scribeErrorResponse(error);
  }
}
