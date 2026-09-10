import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { PractitionerCapability } from '@cureocity/contracts';
const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  lock: vi.fn(),
  audit: vi.fn(),
  formulation: vi.fn(),
  plan: vi.fn(),
  diagnoses: vi.fn(),
  measures: vi.fn(),
}));
vi.mock('./prisma', () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock('./audit', () => ({ writeAudit: mocks.audit }));
vi.mock('./phi-write-lock', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./phi-write-lock')>()),
  lockActiveClient: mocks.lock,
}));
import { loadMindLiveCaseContext } from './mind-live-case-context';
import { ClientPhiWriteForbiddenError } from './phi-write-lock';
const tx = {
  caseFormulation: { findFirst: mocks.formulation },
  treatmentPlan: { findFirst: mocks.plan },
  clientDiagnosis: { findMany: mocks.diagnoses },
  instrumentResponse: { findFirst: mocks.measures },
};
const input = {
  clientId: 'client',
  psychologistId: 'owner',
  capabilities: new Set<PractitionerCapability>(['CLINICAL_ANALYSIS', 'MEASUREMENT_BASED_CARE']),
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('MIND_LIVE_CASE_CONTEXT', 'true');
  mocks.transaction.mockImplementation(async (callback) => callback(tx));
  mocks.lock.mockResolvedValue({ id: 'client' });
  mocks.formulation.mockResolvedValue({
    version: 2,
    body: { version: 'V1', narrative: 'Fictional historical formulation' },
  });
  mocks.plan.mockResolvedValue(null);
  mocks.diagnoses.mockResolvedValue([]);
  mocks.measures.mockResolvedValue(null);
});
afterEach(() => vi.unstubAllEnvs());
describe('explicit live background disclosure', () => {
  it('is default off and does not fetch clinical data before its capability gate', async () => {
    vi.stubEnv('MIND_LIVE_CASE_CONTEXT', '');
    expect(await loadMindLiveCaseContext(input)).toBeNull();
    vi.stubEnv('MIND_LIVE_CASE_CONTEXT', 'true');
    expect(await loadMindLiveCaseContext({ ...input, capabilities: new Set() })).toBeNull();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('returns only current confirmed records under the active-owner lock and audits without content', async () => {
    const result = await loadMindLiveCaseContext(input);
    expect(result?.formulation).toEqual({
      version: 2,
      narrative: 'Fictional historical formulation',
    });
    expect(result?.diagnoses).toEqual([]);
    expect(mocks.lock).toHaveBeenCalledWith(tx, 'client', 'owner');
    expect(mocks.formulation).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ psychologistId: 'owner', supersededAt: null }),
      }),
    );
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain('Fictional historical');
    expect(mocks.audit.mock.calls[0]?.[1]).toBe(tx);
  });
  it('does not read measures without their independent capability', async () => {
    await loadMindLiveCaseContext({ ...input, capabilities: new Set(['CLINICAL_ANALYSIS']) });
    expect(mocks.measures).not.toHaveBeenCalled();
  });
  it('does not disclose after an ownership/erasure race', async () => {
    mocks.lock.mockRejectedValue(new ClientPhiWriteForbiddenError());
    expect(await loadMindLiveCaseContext(input)).toBeNull();
    expect(mocks.formulation).not.toHaveBeenCalled();
  });
  it('does not leak payloads in read/decode failure messages', async () => {
    mocks.formulation.mockRejectedValue(new Error('fictional private narrative'));
    expect(await loadMindLiveCaseContext(input)).toBeNull();
  });
});
