import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { MedicalEncounterNoteV1Schema } from '@cureocity/contracts';
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  query: vi.fn(),
  session: vi.fn(),
  transaction: vi.fn(),
  audit: vi.fn(),
}));
vi.mock('./auth-server', () => ({ requireCapability: h.auth }));
vi.mock('./prisma', () => ({ prisma: { $transaction: h.transaction } }));
vi.mock('./audit', () => ({ auditMetadataFromRequest: () => ({}), writeAudit: h.audit }));
import { GET } from '../app/api/v1/scribe/encounters/[sessionId]/review/route';
const draft = MedicalEncounterNoteV1Schema.parse({
  version: 'V1',
  assessment: 'Original fictional draft',
});
const signed = { ...draft, assessment: 'Clinician corrected assessment' };
const row = () => ({
  psychologistId: 'p1',
  client: { status: 'ACTIVE' },
  noteDraft: { id: 'd1', status: 'COMPLETED', content: draft, errorMessage: null },
  therapyNote: {
    id: 'n1',
    locked: true,
    content: signed,
    rxPad: null,
    signedAt: new Date('2026-10-01T10:00:00Z'),
  },
});
const request = () =>
  GET(new NextRequest('https://example.test/api/v1/scribe/encounters/s1/review'), {
    params: Promise.resolve({ sessionId: 's1' }),
  });
beforeEach(() => {
  vi.resetAllMocks();
  h.auth.mockResolvedValue({
    ok: true,
    value: { psychologistId: 'p1', user: { vertical: 'DOCTOR' } },
  });
  h.query.mockImplementation(async (parts: TemplateStringsArray) =>
    parts.join('?').includes('FROM "clients"')
      ? [{ id: 'c1', psychologistId: 'p1' }]
      : [{ id: 'p1' }],
  );
  h.session.mockResolvedValue(row());
  h.transaction.mockImplementation((run) =>
    run({ $queryRaw: h.query, session: { findUnique: h.session } }),
  );
});
describe('Scribe canonical encounter review snapshot', () => {
  it('returns the attested corrections separately from original draft content', async () => {
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toMatchObject({
      draft: { content: draft },
      signedNote: { content: signed },
    });
    expect(h.audit).toHaveBeenCalledOnce();
    expect(h.query.mock.calls.map(([parts]) => parts.join('?'))).toEqual(
      expect.arrayContaining([expect.stringContaining('FOR SHARE')]),
    );
  });
  it('does not label a reopened note signed merely because signedAt remains populated', async () => {
    h.session.mockResolvedValue({ ...row(), therapyNote: { ...row().therapyNote, locked: false } });
    expect(await (await request()).json()).toMatchObject({
      signedNote: null,
      draft: { content: draft },
    });
  });
  it('returns a genuinely unstarted encounter without fabricating a draft', async () => {
    h.session.mockResolvedValue({ ...row(), noteDraft: null, therapyNote: null });
    expect(await (await request()).json()).toEqual({ draft: null, signedNote: null });
  });
  it.each([
    null,
    { ...row(), psychologistId: 'other' },
    { ...row(), client: { status: 'INACTIVE' } },
  ])('refuses missing/foreign/inactive patient records', async (value) => {
    h.session.mockResolvedValue(value);
    expect((await request()).status).toBe(404);
    expect(h.audit).not.toHaveBeenCalled();
  });
  it('fails closed after erasure or practitioner deactivation', async () => {
    h.query.mockResolvedValue([]);
    expect((await request()).status).toBe(404);
    expect(h.session).not.toHaveBeenCalled();
  });
  it('rejects a therapist without reading clinical records', async () => {
    h.auth.mockResolvedValue({
      ok: true,
      value: { psychologistId: 'p1', user: { vertical: 'THERAPIST' } },
    });
    expect((await request()).status).toBe(403);
    expect(h.transaction).not.toHaveBeenCalled();
  });
  it('does not fall back to the AI draft when the signed record is malformed', async () => {
    h.session.mockResolvedValue({
      ...row(),
      therapyNote: { ...row().therapyNote, content: { version: 'INVALID' } },
    });
    expect((await request()).status).toBe(503);
    expect(h.audit).not.toHaveBeenCalled();
  });
});
