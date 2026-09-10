import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MindManualNoteFieldsSchema, PrepareCrisisFlagSchema } from '@cureocity/contracts';

const m = vi.hoisted(() => ({
  client: vi.fn(),
  capabilities: vi.fn(),
  note: vi.fn(),
  drafts: vi.fn(),
  decrypt: vi.fn(),
  reports: vi.fn(),
  lastSession: vi.fn(),
  instruments: vi.fn(),
  transaction: vi.fn(),
  query: vi.fn(),
}));
vi.mock('./prisma', () => ({
  prisma: {
    client: { findFirst: m.client },
    noteDraft: { findFirst: m.note },
    mindManualNoteDraft: { findMany: m.drafts },
    clinicalReport: { findMany: m.reports },
    session: { findFirst: m.lastSession },
    instrumentResponse: { findMany: m.instruments },
    $transaction: m.transaction,
  },
}));
vi.mock('./capabilities', () => ({ getEffectiveCapabilities: m.capabilities }));
vi.mock('./tenant-crypto', () => ({ decryptForTenant: m.decrypt }));
import { fetchClinicianDocumentedRisk } from './clinician-documented-risk';
import { fetchOpenCrises } from './crisis-flags';

const oldDate = new Date('2026-07-01T10:00:00.000Z');
const recentDate = new Date('2026-09-01T10:00:00.000Z');
const complete = {
  sessionId: 'older-manual-session',
  riskSeverity: 'CRITICAL',
  updatedAt: oldDate,
};
const tx = {
  $queryRaw: m.query,
  noteDraft: { findFirst: m.note },
  mindManualNoteDraft: { findMany: m.drafts },
};

beforeEach(() => {
  vi.resetAllMocks();
  m.client.mockResolvedValue({ psychologistId: 'owner-1' });
  m.capabilities.mockResolvedValue({ capabilities: new Set(['BEHAVIORAL_HEALTH_DOCUMENTATION']) });
  m.note.mockResolvedValue(null);
  m.drafts.mockResolvedValue([]);
  m.reports.mockResolvedValue([]);
  m.lastSession.mockResolvedValue({ scheduledAt: recentDate, endedAt: recentDate });
  m.instruments.mockResolvedValue([]);
  m.query.mockResolvedValue([{ id: 'client-1', psychologistId: 'owner-1' }]);
  m.transaction.mockImplementation(async (work: (database: typeof tx) => Promise<unknown>) =>
    work(tx),
  );
});

describe('clinician-authored safety continuity', () => {
  it('carries a completed manual note through later visits without a ClinicalReport', async () => {
    m.note.mockResolvedValue(complete);
    const flags = await fetchOpenCrises('client-1');
    expect(flags).toEqual([
      {
        kind: 'clinician_documented_risk',
        severity: 'critical',
        lastSeenAt: oldDate.toISOString(),
        source: 'CLINICIAN_NOTE',
        sourceSessionId: 'older-manual-session',
      },
    ]);
    expect(PrepareCrisisFlagSchema.parse(flags[0])).toEqual(flags[0]);
    const query = m.note.mock.calls[0]![0];
    expect(query.where.session).toEqual({
      clientId: 'client-1',
      psychologistId: 'owner-1',
      mindDocumentationMode: 'MANUAL',
      status: 'COMPLETED',
      client: { deletedAt: null },
    });
    expect(query.orderBy[0]).toEqual({ riskSeverity: 'desc' });
    expect(query.where.session).not.toHaveProperty('scheduledAt');
    expect(query.select).not.toHaveProperty('content');
  });

  it('surfaces high risk in a saved unfinished encrypted draft with its own source label', async () => {
    m.drafts.mockResolvedValue([
      { sessionId: 'unfinished', encryptedFields: 'opaque', updatedAt: recentDate },
    ]);
    m.decrypt.mockResolvedValue(
      JSON.stringify(
        MindManualNoteFieldsSchema.parse({
          riskSeverity: 'high',
          subjective: 'Fictional sensitive content',
        }),
      ),
    );
    const flags = await fetchOpenCrises('client-1');
    expect(flags[0]).toEqual({
      kind: 'clinician_draft_documented_risk',
      severity: 'high',
      source: 'CLINICIAN_NOTE_DRAFT',
      sourceSessionId: 'unfinished',
      lastSeenAt: recentDate.toISOString(),
    });
    expect(JSON.stringify(flags)).not.toContain('Fictional sensitive content');
    expect(m.decrypt).toHaveBeenCalledWith('owner-1', 'opaque');
    expect(m.drafts.mock.calls[0]![0]).not.toHaveProperty('take');
  });

  it('does not hide an older critical note behind a newer lower-risk draft', async () => {
    m.note.mockResolvedValue(complete);
    m.drafts.mockResolvedValue([
      { sessionId: 'unfinished', encryptedFields: 'opaque', updatedAt: recentDate },
    ]);
    m.decrypt.mockResolvedValue(
      JSON.stringify(MindManualNoteFieldsSchema.parse({ riskSeverity: 'high' })),
    );
    expect((await fetchClinicianDocumentedRisk('client-1', 'owner-1'))?.sourceSessionId).toBe(
      'older-manual-session',
    );
  });

  it('re-reads corrected source risk instead of inventing a persistent AI flag', async () => {
    m.note.mockResolvedValueOnce(complete).mockResolvedValueOnce(null);
    expect(await fetchClinicianDocumentedRisk('client-1')).not.toBeNull();
    expect(await fetchClinicianDocumentedRisk('client-1')).toBeNull();
  });

  it('requires current behavioral documentation capability before any note read or decryption', async () => {
    m.capabilities.mockResolvedValue({ capabilities: new Set(['SAFETY_PLANNING']) });
    expect(await fetchClinicianDocumentedRisk('client-1', 'owner-1')).toBeNull();
    expect(m.note).not.toHaveBeenCalled();
    expect(m.drafts).not.toHaveBeenCalled();
    expect(m.decrypt).not.toHaveBeenCalled();
  });

  it('excludes erased or foreign-owned clients before any note access', async () => {
    m.client.mockResolvedValue(null);
    expect(await fetchClinicianDocumentedRisk('client-1', 'other-owner')).toBeNull();
    expect(m.client).toHaveBeenCalledWith({
      where: { id: 'client-1', psychologistId: 'other-owner', deletedAt: null },
      select: { psychologistId: true },
    });
    expect(m.note).not.toHaveBeenCalled();
    expect(m.capabilities).not.toHaveBeenCalled();
  });

  it('does not falsely show no flags when encrypted draft context is unavailable', async () => {
    m.drafts.mockResolvedValue([
      { sessionId: 'unfinished', encryptedFields: 'opaque', updatedAt: recentDate },
    ]);
    m.decrypt.mockRejectedValue(new Error('Fictional sensitive KMS failure text'));
    await expect(fetchOpenCrises('client-1')).rejects.toThrow(
      'Saved clinician safety context could not be securely loaded.',
    );
  });

  it('rejects an erasure that wins between initial capability resolution and the client lock', async () => {
    m.note.mockResolvedValue(complete);
    m.query.mockResolvedValue([]);
    expect(await fetchClinicianDocumentedRisk('client-1', 'owner-1')).toBeNull();
    expect(m.transaction).toHaveBeenCalledTimes(1);
    expect(m.note).not.toHaveBeenCalled();
    expect(m.drafts).not.toHaveBeenCalled();
    expect(m.decrypt).not.toHaveBeenCalled();
  });

  it('rechecks ownership under the lock after resolving capability outside the transaction', async () => {
    m.query.mockResolvedValue([{ id: 'client-1', psychologistId: 'changed-owner' }]);
    expect(await fetchClinicianDocumentedRisk('client-1', 'owner-1')).toBeNull();
    expect(m.capabilities.mock.invocationCallOrder[0]).toBeLessThan(
      m.transaction.mock.invocationCallOrder[0]!,
    );
    expect(m.note).not.toHaveBeenCalled();
    expect(m.decrypt).not.toHaveBeenCalled();
  });

  it('keeps the erasure lock for the full encrypted read and releases it only after decryption', async () => {
    const events: string[] = [];
    m.transaction.mockImplementation(async (work: (database: typeof tx) => Promise<unknown>) => {
      events.push('transaction start');
      const result = await work(tx);
      events.push('transaction commit');
      return result;
    });
    m.query.mockImplementation(async () => {
      events.push('client locked');
      return [{ id: 'client-1', psychologistId: 'owner-1' }];
    });
    m.drafts.mockImplementation(async () => {
      events.push('ciphertext read');
      return [{ sessionId: 'unfinished', encryptedFields: 'opaque', updatedAt: recentDate }];
    });
    m.decrypt.mockImplementation(async () => {
      events.push('decrypt under lock');
      expect(events).not.toContain('transaction commit');
      return JSON.stringify(MindManualNoteFieldsSchema.parse({ riskSeverity: 'critical' }));
    });
    expect((await fetchClinicianDocumentedRisk('client-1'))?.severity).toBe('critical');
    expect(events).toEqual([
      'transaction start',
      'client locked',
      'ciphertext read',
      'decrypt under lock',
      'transaction commit',
    ]);
    const sql = m.query.mock.calls[0]![0].join(' ');
    expect(sql).toContain('FOR UPDATE OF c');
    expect(sql).toContain('"deletedAt" IS NULL');
  });

  it('retains critical clinician context within the bounded list even alongside many report flags', async () => {
    m.note.mockResolvedValue(complete);
    m.reports.mockResolvedValue([
      {
        createdAt: recentDate,
        body: {
          crisisFlags: Array.from({ length: 6 }, (_, i) => ({
            kind: `report-${i}`,
            severity: 'critical',
          })),
        },
      },
    ]);
    const flags = await fetchOpenCrises('client-1');
    expect(flags).toHaveLength(5);
    expect(flags[0]?.source).toBe('CLINICIAN_NOTE');
  });

  it('preserves self-check-in and clinician-administered questionnaire warnings until the next completed visit', async () => {
    m.instruments.mockResolvedValue([
      { administeredAt: recentDate, administrationMode: 'CLINICIAN' },
      { administeredAt: recentDate, administrationMode: 'SELF' },
    ]);
    const flags = await fetchOpenCrises('client-1');
    expect(flags.map((f) => f.kind)).toEqual([
      'clinician_administered_suicidality',
      'self_reported_suicidality',
    ]);
    expect(m.instruments.mock.calls[0]![0].where).toEqual({
      clientId: 'client-1',
      riskFlagged: true,
      administeredAt: { gt: recentDate },
    });
    expect(flags.every((f) => f.severity === 'critical')).toBe(true);
  });
});
