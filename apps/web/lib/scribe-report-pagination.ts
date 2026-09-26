import { z } from 'zod';
import type { ScribeRecord } from './scribe-workspace-store';
import { reportSummary, type ReportBody, type ReportSummary } from './scribe-report-schema';
import { ScribeWorkspaceError } from './scribe-workspace-auth';

export const REPORT_LIST_PAGE_SIZE = 5;
const RecordIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/);
export const ReportListQuerySchema = z
  .object({
    clientId: RecordIdSchema,
    sessionId: RecordIdSchema.optional(),
    cursor: z
      .string()
      .min(1)
      .max(512)
      .regex(/^[A-Za-z0-9_-]+$/)
      .optional(),
  })
  .strict();
const CursorSchema = z
  .object({
    version: z.literal(1),
    createdAt: z.string().datetime(),
    id: RecordIdSchema,
  })
  .strict();

export interface ReportListPage {
  records: ScribeRecord<ReportSummary>[];
  nextCursor: string | null;
}

export function decodeReportCursor(cursor: string): { createdAt: string; id: string } {
  try {
    if (!cursor || cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor))
      throw new Error('cursor');
    const bytes = Buffer.from(cursor, 'base64url');
    if (bytes.toString('base64url') !== cursor) throw new Error('cursor');
    const value = CursorSchema.parse(JSON.parse(bytes.toString('utf8')));
    return { createdAt: value.createdAt, id: value.id };
  } catch {
    throw new ScribeWorkspaceError(400, 'Invalid page cursor. Reload the report list.');
  }
}

export function reportListPage(rows: ScribeRecord<ReportBody>[]): ReportListPage {
  const records = rows.slice(0, REPORT_LIST_PAGE_SIZE);
  const last = records[records.length - 1];
  return {
    records: records.map((record) => ({ ...record, body: reportSummary(record.body) })),
    nextCursor:
      rows.length > REPORT_LIST_PAGE_SIZE && last
        ? Buffer.from(
            JSON.stringify({ version: 1, createdAt: last.createdAt, id: last.id }),
            'utf8',
          ).toString('base64url')
        : null,
  };
}
