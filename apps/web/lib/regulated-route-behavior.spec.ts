import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireCapability: vi.fn(),
  requireAnyCapability: vi.fn(),
  buildEncounterFhir: vi.fn(),
  writeAudit: vi.fn(),
  medicationUpdate: vi.fn(),
  clinicalOrderUpdate: vi.fn(),
  medicationFindMany: vi.fn(),
  clinicalOrderFindMany: vi.fn(),
  sessionFindUnique: vi.fn(),
}));
vi.mock('./auth-server', () => ({
  requireCapability: mocks.requireCapability,
  requireAnyCapability: mocks.requireAnyCapability,
}));
vi.mock('./fhir-export', () => ({
  FhirExportError: class FhirExportError extends Error {},
  buildEncounterFhir: mocks.buildEncounterFhir,
}));
vi.mock('./audit', () => ({ auditMetadataFromRequest: vi.fn(), writeAudit: mocks.writeAudit }));
vi.mock('./prisma', () => ({
  prisma: {
    medicationOrder: {
      findUnique: vi.fn(),
      findMany: mocks.medicationFindMany,
      update: mocks.medicationUpdate,
    },
    clinicalOrder: {
      findUnique: vi.fn(),
      findMany: mocks.clinicalOrderFindMany,
      update: mocks.clinicalOrderUpdate,
    },
    session: { findUnique: mocks.sessionFindUnique },
  },
}));

import { GET as exportFhir } from '../app/api/v1/sessions/[id]/fhir/route';
import { PATCH as updateMedication } from '../app/api/v1/medication-orders/[id]/route';
import { PATCH as updateClinicalOrder } from '../app/api/v1/clinical-orders/[id]/route';
import { GET as getOrders } from '../app/api/v1/sessions/[id]/orders/route';

beforeEach(() => vi.clearAllMocks());

describe('regulated route denial behavior', () => {
  it('does not disclose FHIR data when the capability is absent or revoked', async () => {
    mocks.requireCapability.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: 'not authorized' }), { status: 403 }),
    });
    const response = await exportFhir(new Request('https://example.test') as never, {
      params: Promise.resolve({ id: 'session-1' }),
    });
    expect(response.status).toBe(403);
    expect(mocks.requireCapability).toHaveBeenCalledWith(expect.anything(), 'FHIR_EXPORT');
    expect(mocks.buildEncounterFhir).not.toHaveBeenCalled();
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });

  it.each([
    ['prescription drafting', updateMedication, 'PRESCRIPTION_DRAFTING', mocks.medicationUpdate],
    ['clinical orders', updateClinicalOrder, 'CLINICAL_ORDERS', mocks.clinicalOrderUpdate],
  ])(
    'returns 403 with no persistence for absent or revoked %s authority',
    async (_label, handler, capability, update) => {
      mocks.requireCapability.mockResolvedValue({
        ok: false,
        response: new Response(JSON.stringify({ error: 'not authorized' }), { status: 403 }),
      });
      const response = await handler(
        new Request('https://example.test', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: 'DISCARDED' }),
        }) as never,
        { params: Promise.resolve({ id: 'order-1' }) },
      );

      expect(response.status).toBe(403);
      expect(mocks.requireCapability).toHaveBeenCalledWith(expect.anything(), capability);
      expect(update).not.toHaveBeenCalled();
    },
  );

  it('returns only independently authorized actions from the mixed orders route', async () => {
    mocks.requireAnyCapability.mockResolvedValue({
      ok: true,
      value: {
        psychologistId: 'psy-1',
        user: {
          firebaseUid: 'uid',
          capabilities: ['PRESCRIPTION_DRAFTING'],
        },
      },
    });
    mocks.sessionFindUnique.mockResolvedValue({ psychologistId: 'psy-1' });
    mocks.medicationFindMany.mockResolvedValue([]);

    const response = await getOrders(new Request('https://example.test') as never, {
      params: Promise.resolve({ id: 'session-1' }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ medications: [], clinicalOrders: [] });
    expect(mocks.medicationFindMany).toHaveBeenCalledOnce();
    expect(mocks.clinicalOrderFindMany).not.toHaveBeenCalled();
  });
});
