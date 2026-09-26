import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ query: vi.fn(), rows: vi.fn(), decrypt: vi.fn(), lock: vi.fn() }));
vi.mock('./tenant-crypto', () => ({ decryptForTenant: m.decrypt }));
vi.mock('./phi-write-lock', () => ({ lockActiveClient: m.lock }));
import {
  hasScribeWorkspaceStorage,
  loadScribeWorkspaceExport,
  redactScribeExportCredentials,
} from './scribe-workspace-privacy';

const tx = { $queryRaw: m.query, scribeWorkspaceRecord: { findMany: m.rows } };
const owner = 'doctor-1';
const client = 'patient-1';
const capabilities = new Set(['MEDICAL_DOCUMENTATION'] as const);
const record = {
  id: 'report-1',
  psychologistId: owner,
  clientId: client,
  sessionId: 'session-1',
  kind: 'report',
  revision: 1,
  bodyEncrypted: 'envelope',
  createdAt: new Date('2026-09-25T10:00:00Z'),
  updatedAt: new Date('2026-09-25T10:00:00Z'),
};
beforeEach(() => {
  vi.resetAllMocks();
  m.query.mockResolvedValue([{ exists: true }]);
  m.rows.mockResolvedValue([record]);
  m.decrypt.mockResolvedValue(
    JSON.stringify({
      name: 'Fictional result',
      original: { base64: 'privatebytes', mimeType: 'application/pdf' },
    }),
  );
});

describe('Scribe patient access exports', () => {
  it('excludes personal templates from a patient DSR without claiming doctor-account export support', async () => {
    const personal = {
      ...record,
      id: 'template-private',
      kind: 'template',
      clientId: null,
      sessionId: null,
      bodyEncrypted: 'private-template-envelope',
    };
    const patient = { ...record, kind: 'documents', bodyEncrypted: 'patient-document-envelope' };
    m.rows.mockImplementation(async ({ where }) =>
      [personal, patient].filter(
        (row) => row.clientId === where.clientId && row.psychologistId === where.psychologistId,
      ),
    );
    m.decrypt.mockResolvedValue(JSON.stringify({ additions: 'Fictional patient draft' }));
    const result = await loadScribeWorkspaceExport(tx as never, client, owner, capabilities);
    expect(result.scribeWorkspaceRecords?.map((item) => item.kind)).toEqual(['documents']);
    expect(m.decrypt).not.toHaveBeenCalledWith(owner, 'private-template-envelope');
    expect(JSON.stringify(result)).not.toContain('template-private');
  });
  it('exports every document in a consultation packet, including draft clinician additions', async () => {
    m.rows.mockResolvedValue([{ ...record, kind: 'documents', id: 'packet-a' }]);
    const body = {
      version: 1,
      sourceHash: 'a'.repeat(64),
      documents: [
        { id: 'referral', additions: 'Fictional doctor addition', status: 'draft' },
        { id: 'medical_certificate', additions: '', status: 'reviewed', reviewedBy: owner },
      ],
    };
    m.decrypt.mockResolvedValue(JSON.stringify(body));
    const result = await loadScribeWorkspaceExport(tx as never, client, owner, capabilities);
    expect(result.scribeWorkspaceRecords?.[0]).toMatchObject({ kind: 'documents', body });
    expect(m.rows).toHaveBeenCalledWith(
      expect.objectContaining({ where: { clientId: client, psychologistId: owner } }),
    );
  });
  it('exports reviewed coding and its clinician provenance through the generic patient scope', async () => {
    m.rows.mockResolvedValue([{ ...record, kind: 'coding', id: 'coding-a' }]);
    const body = {
      worksheet: {
        version: 'V1',
        status: 'reviewed',
        entries: [{ code: 'R51.9', decision: 'include' }],
      },
      reviewedBy: owner,
      reviewedAt: '2026-09-26T00:00:00Z',
      reviewedNoteHash: 'a'.repeat(64),
    };
    m.decrypt.mockResolvedValue(JSON.stringify(body));
    const result = await loadScribeWorkspaceExport(tx as never, client, owner, capabilities);
    expect(result.scribeWorkspaceRecords?.[0]).toMatchObject({ kind: 'coding', body });
    expect(m.rows).toHaveBeenCalledWith(
      expect.objectContaining({ where: { clientId: client, psychologistId: owner } }),
    );
  });
  it('includes encrypted teleconsult consent records without raw invitation credentials', async () => {
    m.rows.mockResolvedValue([{ ...record, kind: 'teleconsult', id: 'call-a' }]);
    m.decrypt.mockResolvedValue(
      JSON.stringify({
        product: 'SCRIBE',
        patientConsent: 'withdrawn',
        documentationState: 'paused',
        token: 'never-export-this',
      }),
    );
    const result = await loadScribeWorkspaceExport(tx as never, client, owner, capabilities);
    expect(result.scribeWorkspaceRecords?.[0]).toMatchObject({
      kind: 'teleconsult',
      body: { product: 'SCRIBE', patientConsent: 'withdrawn' },
    });
    expect(JSON.stringify(result)).not.toContain('never-export-this');
    expect(m.rows).toHaveBeenCalledWith(
      expect.objectContaining({ where: { clientId: client, psychologistId: owner } }),
    );
  });
  it('exports every page under the patient lock and decrypts report originals sequentially', async () => {
    const rows = Array.from({ length: 7 }, (_, index) => ({
      ...record,
      id: `report-${index + 1}`,
      bodyEncrypted: `envelope-${index + 1}`,
    }));
    m.rows.mockResolvedValueOnce(rows.slice(0, 5)).mockResolvedValueOnce(rows.slice(5));
    let active = 0;
    let maximumActive = 0;
    m.decrypt.mockImplementation(async (_owner, envelope: string) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
      return JSON.stringify({
        label: envelope,
        original: { base64: 'privatebytes', mimeType: 'application/pdf' },
        tokenHash: 'secret',
      });
    });
    const result = await loadScribeWorkspaceExport(tx as never, client, owner, capabilities);
    expect(result.scribeWorkspaceRecords?.map((item) => item.id)).toEqual(
      rows.map((item) => item.id),
    );
    expect(m.rows).toHaveBeenCalledTimes(2);
    expect(m.rows).toHaveBeenNthCalledWith(1, {
      where: { clientId: client, psychologistId: owner },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 5,
    });
    expect(m.rows).toHaveBeenNthCalledWith(2, {
      where: { clientId: client, psychologistId: owner },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 5,
      cursor: { id: 'report-5' },
      skip: 1,
    });
    expect(m.lock.mock.invocationCallOrder[0]).toBeLessThan(m.rows.mock.invocationCallOrder[0]);
    expect(maximumActive).toBe(1);
    expect(m.decrypt).toHaveBeenCalledTimes(7);
    expect(JSON.stringify(result)).not.toContain('privatebytes');
    expect(JSON.stringify(result)).not.toContain('secret');
  });
  it('locks the active patient, filters owner, and includes individually authenticated report originals', async () => {
    const result = await loadScribeWorkspaceExport(tx as never, client, owner, capabilities);
    expect(m.lock).toHaveBeenCalledWith(tx, client, owner);
    expect(m.rows).toHaveBeenCalledWith(
      expect.objectContaining({ where: { clientId: client, psychologistId: owner } }),
    );
    const body = result.scribeWorkspaceRecords?.[0]?.body as Record<string, unknown>;
    expect(body.original).toEqual({
      mimeType: 'application/pdf',
      authenticatedDownloadPath: '/api/v1/scribe/reports/report-1/original',
      exportNote: expect.any(String),
    });
    expect(JSON.stringify(result)).not.toContain('privatebytes');
    expect(JSON.stringify(result)).not.toContain('envelope');
  });

  it('removes intake credentials even when nested, preserving submitted clinical data', () => {
    expect(
      redactScribeExportCredentials({
        tokenHash: 'hidden',
        fields: { complaint: 'Fictional', token: 'hidden' },
        entries: [{ accessToken: 'hidden', value: 7 }],
      }),
    ).toEqual({ fields: { complaint: 'Fictional' }, entries: [{ value: 7 }] });
  });

  it('marks missing clinical authority explicitly and does not read records', async () => {
    expect(await loadScribeWorkspaceExport(tx as never, client, owner, new Set())).toEqual({
      omittedScribeWorkspace: true,
    });
    expect(m.rows).not.toHaveBeenCalled();
  });

  it('permits only confirmed pre-migration absence, not broken discovery', async () => {
    m.query.mockResolvedValueOnce([{ exists: false }]);
    expect(await loadScribeWorkspaceExport(tx as never, client, owner, capabilities)).toEqual({
      scribeWorkspaceRecords: [],
    });
    expect(m.rows).not.toHaveBeenCalled();
    m.query.mockResolvedValueOnce([]);
    await expect(hasScribeWorkspaceStorage(tx as never)).rejects.toThrow('could not be verified');
    m.query.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(hasScribeWorkspaceStorage(tx as never)).rejects.toThrow('database unavailable');
  });

  it('fails the entire export on decryption or query failure rather than silently omitting records', async () => {
    m.decrypt.mockResolvedValueOnce(null);
    await expect(
      loadScribeWorkspaceExport(tx as never, client, owner, capabilities),
    ).rejects.toThrow('unavailable');
    m.rows.mockRejectedValueOnce(new Error('broken storage'));
    await expect(
      loadScribeWorkspaceExport(tx as never, client, owner, capabilities),
    ).rejects.toThrow('broken storage');
  });
});
