import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { ReportBodySchema } from './scribe-report-schema';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), list: vi.fn() }));
vi.mock('./auth-server', () => ({ requireCapability: mocks.auth }));
vi.mock('./scribe-workspace-store', () => ({
  listScribeRecords: mocks.list,
  createScribeRecord: vi.fn(),
}));
vi.mock('./scribe-report-processing', () => ({
  readReportUpload: vi.fn(),
  validateReportFile: vi.fn(),
  extractReport: vi.fn(),
}));
vi.mock('./scribe-document-ai', () => ({
  assertDocumentConsent: vi.fn(),
  documentAiConfig: vi.fn(),
}));
import {
  decodeReportCursor,
  reportListPage,
  REPORT_LIST_PAGE_SIZE,
  ReportListQuerySchema,
} from './scribe-report-pagination';
import { GET } from '../app/api/v1/scribe/reports/route';

const body = ReportBodySchema.parse({
  version: 1,
  status: 'candidate',
  original: {
    name: 'Fictional-report.pdf',
    mime: 'application/pdf',
    size: 3,
    pages: 1,
    sha256: 'a'.repeat(64),
    base64: 'YWJj',
  },
  candidates: [
    {
      id: 'value-1',
      name: 'Fictional test',
      value: '3',
      unit: 'mg',
      reportDate: '',
      page: 1,
      sourceText: 'Fictional test 3 mg',
      included: true,
    },
  ],
  extractedAt: '2026-09-25T00:00:00Z',
  reviewedAt: null,
  reviewedBy: null,
});
const rows = Array.from({ length: 12 }, (_, index) => ({
  id: `report-${String(index).padStart(2, '0')}`,
  clientId: 'patient-1',
  sessionId: 'visit-1',
  revision: 1,
  createdAt: '2026-09-25T00:00:00.000Z',
  updatedAt: '2026-09-25T00:00:00.000Z',
  body,
}));
const request = (query = '') =>
  new NextRequest(
    `https://example.test/api/v1/scribe/reports?clientId=patient-1&sessionId=visit-1${query}`,
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({
    ok: true,
    value: { psychologistId: 'doctor-1', user: { vertical: 'DOCTOR' } },
  });
  mocks.list.mockImplementation(async (scope) =>
    rows
      .filter(
        (row) =>
          !scope.page?.after ||
          row.createdAt < scope.page.after.createdAt ||
          (row.createdAt === scope.page.after.createdAt && row.id > scope.page.after.id),
      )
      .slice(0, scope.limit),
  );
});

describe('bounded report list contract', () => {
  it('emits five summaries and a cursor, never original bytes or narrative in the cursor', () => {
    const page = reportListPage(rows.slice(0, 6));
    expect(page.records).toHaveLength(REPORT_LIST_PAGE_SIZE);
    expect(JSON.stringify(page)).not.toContain('base64');
    expect(JSON.stringify(page)).not.toContain('YWJj');
    expect(decodeReportCursor(page.nextCursor!)).toEqual({
      createdAt: rows[4].createdAt,
      id: rows[4].id,
    });
    expect(Buffer.from(page.nextCursor!, 'base64url').toString()).not.toContain('Fictional');
  });
  it.each([0, 1, 5])('returns no next cursor when only %i records remain', (count) => {
    expect(reportListPage(rows.slice(0, count)).nextCursor).toBeNull();
  });
  it.each([
    '',
    'not-a-cursor',
    'e30',
    'x'.repeat(513),
    Buffer.from(
      JSON.stringify({ version: 2, id: 'report-1', createdAt: rows[0].createdAt }),
    ).toString('base64url'),
  ])('rejects invalid cursor %s', (cursor) => {
    expect(() => decodeReportCursor(cursor)).toThrow('Invalid page cursor');
  });
  it('rejects client-supplied page sizes and malformed scope identifiers', () => {
    expect(ReportListQuerySchema.safeParse({ clientId: 'patient-1', limit: '500' }).success).toBe(
      false,
    );
    expect(ReportListQuerySchema.safeParse({ clientId: '../patient' }).success).toBe(false);
    expect(ReportListQuerySchema.safeParse({ clientId: 'patient-1', cursor: '$bad' }).success).toBe(
      false,
    );
  });
});

describe('report cursor route', () => {
  it('fetches at most five plus one with private responses and unchanged patient/session authority', async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.list).toHaveBeenCalledWith(
      {
        psychologistId: 'doctor-1',
        kind: 'report',
        clientId: 'patient-1',
        sessionId: 'visit-1',
        limit: 6,
        page: {},
      },
      ReportBodySchema,
    );
    expect((await response.json()).records).toHaveLength(5);
  });
  it('makes every older record reachable across tied creation timestamps without duplication', async () => {
    const found: string[] = [];
    let cursor: string | null = null;
    do {
      const response = await GET(request(cursor ? `&cursor=${cursor}` : ''));
      const page = await response.json();
      found.push(...page.records.map((row: { id: string }) => row.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(found).toEqual(rows.map((row) => row.id));
    expect(mocks.list).toHaveBeenCalledTimes(3);
    expect(mocks.list.mock.calls.every(([scope]) => scope.limit === 6)).toBe(true);
  });
  it('rejects invalid cursors and attempts to raise the page limit before storage', async () => {
    expect((await GET(request('&cursor=e30'))).status).toBe(400);
    expect((await GET(request('&limit=500'))).status).toBe(400);
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it('still scopes a caller-chosen cursor to the authenticated patient, never the cursor identity', async () => {
    const cursor = Buffer.from(
      JSON.stringify({ version: 1, id: 'other-tenant-record', createdAt: rows[0].createdAt }),
    ).toString('base64url');
    await GET(request(`&cursor=${cursor}`));
    expect(mocks.list).toHaveBeenCalledWith(
      expect.objectContaining({
        psychologistId: 'doctor-1',
        clientId: 'patient-1',
        sessionId: 'visit-1',
        page: { after: { id: 'other-tenant-record', createdAt: rows[0].createdAt } },
      }),
      ReportBodySchema,
    );
  });
  it('requires authentication before decoding or fetching report pages', async () => {
    mocks.auth.mockResolvedValue({ ok: false, response: NextResponse.json({}, { status: 401 }) });
    expect((await GET(request('&cursor=e30'))).status).toBe(401);
    expect(mocks.list).not.toHaveBeenCalled();
  });
});
