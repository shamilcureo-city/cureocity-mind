import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MeterSummarySchema } from '@cureocity/contracts';

const mock = vi.hoisted(() => ({
  writeAudit: vi.fn(),
  findSession: vi.fn(),
  findMetric: vi.fn(),
  upsertMetric: vi.fn(),
  createLog: vi.fn(),
}));
vi.mock('@/lib/auth-server', () => ({
  requirePsychologistId: async () => ({ ok: true, value: { psychologistId: 'psy-test' } }),
}));
vi.mock('@/lib/audit', () => ({
  writeAudit: mock.writeAudit,
  auditMetadataFromRequest: () => ({}),
}));
vi.mock('@/lib/prisma', () => ({ prisma: { session: { findUnique: mock.findSession } } }));
vi.mock('@/lib/validate', () => ({
  parseJson: async (req: Request, schema: typeof MeterSummarySchema) => ({
    ok: true,
    value: schema.parse(await req.json()),
  }),
}));
vi.mock('@/lib/phi-write-lock', () => ({
  ClientPhiWriteForbiddenError: class extends Error {},
  withActiveSessionPhiWrite: async (
    _db: unknown,
    _session: unknown,
    _psy: unknown,
    callback: (tx: unknown) => Promise<unknown>,
  ) =>
    callback({
      liveConsultMetric: { findUnique: mock.findMetric, upsert: mock.upsertMetric },
      geminiCallLog: { create: mock.createLog },
    }),
}));

import { POST } from '../app/api/v1/sessions/[id]/live-metric/route';

describe('live cost breakdown audit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock.findSession.mockResolvedValue({ id: 'session-test', psychologistId: 'psy-test' });
    mock.findMetric.mockResolvedValue(null);
    mock.upsertMetric.mockResolvedValue({ id: 'metric-test' });
  });

  it('stores numeric categories without copying extra transcript or note content', async () => {
    const summary = {
      sessionId: 'session-test',
      backend: 'vertex',
      windows: 1,
      pass1Calls: 1,
      pass2Calls: 1,
      reasoningCalls: 1,
      inputTokens: 100,
      outputTokens: 100,
      costInr: 0.25,
      transcriptP50Ms: 1,
      transcriptP95Ms: 2,
      noteP50Ms: 1,
      noteP95Ms: 2,
      elapsedMs: 60000,
      costBreakdown: {
        transcriptionInr: 0.1,
        notesInr: 0.1,
        reasoningInr: 0.05,
        transcript: 'FICTIONAL_TEXT_MUST_NOT_BE_LOGGED',
      },
      note: 'FICTIONAL_NOTE_MUST_NOT_BE_LOGGED',
    };
    const req = new Request('https://example.test/api/v1/sessions/session-test/live-metric', {
      method: 'POST',
      body: JSON.stringify(summary),
      headers: { 'Content-Type': 'application/json' },
    });
    const response = await POST(req as never, { params: Promise.resolve({ id: 'session-test' }) });
    expect(response.status).toBe(201);
    expect(mock.writeAudit).toHaveBeenCalledOnce();
    const metadata = mock.writeAudit.mock.calls[0]![0].metadata;
    expect(metadata).toEqual({
      sessionId: 'session-test',
      backend: 'vertex',
      windows: 1,
      costInr: 0.25,
      transcriptP95Ms: 2,
      reasoningCalls: 1,
      costBreakdown: { transcriptionInr: 0.1, notesInr: 0.1, reasoningInr: 0.05 },
    });
    expect(JSON.stringify(metadata)).not.toContain('MUST_NOT_BE_LOGGED');
  });
});
