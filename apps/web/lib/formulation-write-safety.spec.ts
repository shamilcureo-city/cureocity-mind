import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CaseFormulationV1Schema,
  ClinicalReportV1Schema,
  type CaseFormulationV1,
  type FormulationSuggestion,
} from '@cureocity/contracts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  client: vi.fn(),
  query: vi.fn(),
  report: vi.fn(),
  transaction: vi.fn(),
  audit: vi.fn(),
}));
vi.mock('./auth-server', () => ({ requirePsychologistId: m.auth }));
vi.mock('./audit', () => ({ auditMetadataFromRequest: () => ({}), writeAudit: m.audit }));
vi.mock('./prisma', () => ({
  prisma: { client: { findFirst: m.client }, $transaction: m.transaction },
}));
import { POST } from '../app/api/v1/clients/[id]/formulation/route';

const initial = (): CaseFormulationV1 =>
  CaseFormulationV1Schema.parse({ version: 'V1', narrative: 'Initial fictional case' });
type Row = { id: string; version: number; body: CaseFormulationV1; supersededAt: Date | null };
let rows: Row[];
function save(payload: unknown) {
  return POST(
    new Request('https://example.test/api/v1/clients/client-1/formulation', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }) as never,
    { params: Promise.resolve({ id: 'client-1' }) },
  );
}
const author = (expectedVersion: number, formulation = initial()) =>
  save({ action: 'author', expectedVersion, formulation });
const accept = (expectedVersion = 1) =>
  save({ action: 'accept', expectedVersion, reportId: 'report-1', suggestionIndex: 0 });
function setSuggestion(suggestion: Partial<FormulationSuggestion>) {
  m.report.mockResolvedValue({
    id: 'report-1',
    sessionId: 'visit-1',
    status: 'COMPLETED',
    body: ClinicalReportV1Schema.parse({
      version: 'V1',
      modality: 'SUPPORTIVE',
      diagnosisCandidates: [],
      primaryDiagnosisIndex: null,
      formulation: 'Fictional example',
      recommendedTherapies: [],
      treatmentPlan: {
        modality: 'supportive',
        phaseSequence: ['Review', 'Continue'],
        goals: [{ description: 'Agreed goal', measure: 'Client report' }],
        expectedDurationSessions: null,
      },
      formulationSuggestions: [
        { target: 'PROTECTIVE', action: 'ADD', text: 'New support', ...suggestion },
      ],
    }),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  rows = [{ id: 'v1', version: 1, body: initial(), supersededAt: null }];
  m.auth.mockResolvedValue({ ok: true, value: { psychologistId: 'psy-1' } });
  m.client.mockResolvedValue({ id: 'client-1' });
  m.query.mockResolvedValue([{ id: 'client-1', psychologistId: 'psy-1' }]);
  setSuggestion({});
  let tail = Promise.resolve();
  m.transaction.mockImplementation(async (fn) => {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>((done) => {
      release = done;
    });
    await previous;
    const before = structuredClone(rows);
    try {
      return await fn({
        $queryRaw: m.query,
        clinicalReport: { findFirst: m.report },
        caseFormulation: {
          findFirst: async () =>
            rows
              .filter((row) => row.supersededAt === null)
              .sort((a, b) => b.version - a.version)[0] ?? null,
          updateMany: async ({ data }: { data: { supersededAt: Date } }) => {
            rows.forEach((row) => {
              if (!row.supersededAt) row.supersededAt = data.supersededAt;
            });
          },
          aggregate: async () => ({
            _max: { version: rows.length ? Math.max(...rows.map((row) => row.version)) : null },
          }),
          create: async ({ data }: { data: Omit<Row, 'id' | 'supersededAt'> }) => {
            const row = { ...data, id: `v${data.version}`, supersededAt: null };
            rows.push(row);
            return row;
          },
        },
      });
    } catch (error) {
      rows = before;
      throw error;
    } finally {
      release();
    }
  });
});

describe('versioned formulation writes', () => {
  it('rejects a stale editor without replacing the newer active version or losing historical work', async () => {
    const a = { ...initial(), narrative: 'Tab A new understanding' };
    expect((await author(1, a)).status).toBe(200);
    const stale = await author(1, { ...initial(), narrative: 'Tab B old draft' });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: 'FORMULATION_VERSION_CONFLICT' });
    expect(rows).toHaveLength(2);
    expect(rows[1]!.body.narrative).toBe(a.narrative);
    expect(rows[0]!.body).toEqual(initial());
    expect(m.audit).toHaveBeenCalledOnce();
  });
  it('allows only one concurrent first save against version zero', async () => {
    rows = [];
    const outcomes = await Promise.all([
      author(0),
      author(0, { ...initial(), narrative: 'Other first draft' }),
    ]);
    expect(outcomes.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(rows).toHaveLength(1);
  });
  it('refuses missing revision inputs from stale clients', async () => {
    expect((await save({ action: 'author', formulation: initial() })).status).toBe(400);
    expect(
      (await save({ action: 'accept', reportId: 'report-1', suggestionIndex: 0 })).status,
    ).toBe(400);
    expect(m.transaction).not.toHaveBeenCalled();
  });
  it('rejects a stale suggestion before interpreting or applying it to the newer record', async () => {
    const response = await accept(0);
    expect(response.status).toBe(409);
    expect(m.report).not.toHaveBeenCalled();
    expect(rows).toHaveLength(1);
  });
  it('rechecks client ownership/erasure under the write lock', async () => {
    m.query.mockResolvedValue([]);
    expect((await author(1)).status).toBe(404);
    expect(rows).toHaveLength(1);
    expect(m.audit).not.toHaveBeenCalled();
  });
  it('versions an applicable suggestion after the current revision check', async () => {
    const response = await accept();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ version: 2 });
    expect(rows[1]!.body.fivePs.protective).toEqual(['New support']);
    expect(m.query.mock.invocationCallOrder[0]).toBeLessThan(m.report.mock.invocationCallOrder[0]!);
  });
  it.each([
    'PREDISPOSING',
    'PRECIPITATING',
    'PERPETUATING',
    'PROTECTIVE',
    'CYCLE',
    'PREDICTION',
  ] as const)(
    'rejects a full %s section without a new version, audit, or success receipt',
    async (target) => {
      const full = rows[0]!.body;
      if (target === 'CYCLE')
        full.cycle = Array.from({ length: 8 }, (_, i) => ({
          role: 'THOUGHT',
          text: `Thought ${i}`,
          breaking: false,
        }));
      else if (target === 'PREDICTION')
        full.predictions = Array.from({ length: 6 }, (_, i) => ({
          text: `Prediction ${i}`,
          status: 'TO_TEST',
        }));
      else
        full.fivePs[target.toLowerCase() as keyof typeof full.fivePs] = Array.from(
          { length: 8 },
          (_, i) => `Existing ${i}`,
        );
      setSuggestion({ target, text: 'New item beyond capacity' });
      const before = structuredClone(rows);
      const response = await accept();
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: 'FORMULATION_CAPACITY_REACHED' });
      expect(rows).toEqual(before);
      expect(m.audit).not.toHaveBeenCalled();
    },
  );
  it('still applies a matching revision at capacity', async () => {
    rows[0]!.body.cycle = Array.from({ length: 8 }, (_, i) => ({
      role: 'THOUGHT',
      text: `Thought ${i}`,
      breaking: false,
    }));
    setSuggestion({
      target: 'CYCLE',
      action: 'REVISE',
      cycleRole: 'THOUGHT',
      text: 'Revised understanding',
    });
    expect((await accept()).status).toBe(200);
    expect(rows[1]!.body.cycle).toHaveLength(8);
    expect(rows[1]!.body.cycle[0]!.text).toBe('Revised understanding');
  });
  it('acknowledges an already-present suggestion without manufacturing a confirmation', async () => {
    rows[0]!.body.fivePs.protective = ['New support'];
    expect((await accept()).status).toBe(200);
    expect(rows).toHaveLength(1);
    expect(m.audit).not.toHaveBeenCalled();
  });
  it('keeps a draft bound to the version displayed when editing started', () => {
    const editor = readFileSync(
      resolve(process.cwd(), 'components/app/FormulationCard.tsx'),
      'utf8',
    );
    expect(editor).toContain('expectedVersion: draftVersion');
    expect(editor).toContain('setDraftVersion(data.formulation?.version ?? 0)');
    expect(editor).toContain('if (res.status === 409) router.refresh()');
    const board = readFileSync(
      resolve(process.cwd(), 'components/app/CopilotDecisionBoard.tsx'),
      'utf8',
    );
    expect(board).toContain('expectedVersion: closeout.formulationVersion');
  });
});
