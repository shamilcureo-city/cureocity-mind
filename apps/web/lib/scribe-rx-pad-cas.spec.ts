import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { RxPadDraftSchema, type RxPadDraft } from '@cureocity/contracts';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  initial: vi.fn(),
  current: vi.fn(),
  transaction: vi.fn(),
  query: vi.fn(),
  update: vi.fn(),
  audit: vi.fn(),
}));
vi.mock('./auth-server', () => ({ requireCapability: mocks.auth }));
vi.mock('./prisma', () => ({
  prisma: { session: { findUnique: mocks.initial }, $transaction: mocks.transaction },
}));
vi.mock('./audit', () => ({ auditMetadataFromRequest: () => ({}), writeAudit: mocks.audit }));
import { GET, PATCH } from '../app/api/v1/sessions/[id]/rx-pad/route';

const pad = (): RxPadDraft =>
  RxPadDraftSchema.parse({
    version: 'V1',
    meds: [{ drug: 'Fictional A', dose: '1 tablet', status: 'confirmed' }],
    adviceLines: [],
  });
type Session = {
  id: string;
  psychologistId: string;
  psychologist: { vertical: string };
  noteDraft: { id: string; rxPad: RxPadDraft | null } | null;
  therapyNote: { signedAt: Date; locked: boolean } | null;
};
const session = (): Session => ({
  id: 'session-1',
  psychologistId: 'doctor-1',
  psychologist: { vertical: 'DOCTOR' },
  noteDraft: { id: 'draft-1', rxPad: pad() },
  therapyNote: null,
});
let current = session();
const context = { params: Promise.resolve({ id: 'session-1' }) };
const operation = { op: 'addAdvice', source: 'manual', text: 'Fictional reviewed advice' };
function patch(body: unknown = { expectedPad: pad(), ops: [operation] }) {
  return PATCH(
    new NextRequest('https://example.test/api/v1/sessions/session-1/rx-pad', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    context,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  current = session();
  mocks.auth.mockResolvedValue({
    ok: true,
    value: { psychologistId: 'doctor-1', user: { vertical: 'DOCTOR' } },
  });
  mocks.initial.mockResolvedValue(session());
  mocks.current.mockImplementation(async () => current);
  mocks.query.mockImplementation(async (strings: TemplateStringsArray) =>
    strings.join('?').includes('FROM "clients"')
      ? [{ id: 'patient-1', psychologistId: 'doctor-1' }]
      : [],
  );
  mocks.transaction.mockImplementation(async (work) =>
    work({
      $queryRaw: mocks.query,
      session: { findUnique: mocks.current },
      noteDraft: { update: mocks.update },
    }),
  );
});

describe('prescription PATCH optimistic review and sign serialization', () => {
  it('reads the immutable signed pad, never newer mutable draft content, while locked', async () => {
    mocks.initial.mockResolvedValue({
      ...session(),
      therapyNote: {
        locked: true,
        signedAt: new Date(),
        rxPad: { ...pad(), adviceLines: ['Signed advice'] },
      },
    });
    const response = await GET(
      new NextRequest('https://example.test/api/v1/sessions/session-1/rx-pad'),
      context,
    );
    expect(await response.json()).toMatchObject({
      signed: true,
      rxPad: { adviceLines: ['Signed advice'] },
    });
  });
  it('reads the editable draft after reopening instead of the historical signed pad', async () => {
    mocks.initial.mockResolvedValue({
      ...session(),
      therapyNote: {
        locked: false,
        signedAt: new Date(),
        rxPad: { ...pad(), adviceLines: ['Prior signed advice'] },
      },
    });
    const response = await GET(
      new NextRequest('https://example.test/api/v1/sessions/session-1/rx-pad'),
      context,
    );
    expect(await response.json()).toMatchObject({ signed: false, rxPad: { adviceLines: [] } });
  });
  it('rejects an expected-pad mismatch against the locked reread, not the preflight snapshot', async () => {
    current.noteDraft!.rxPad = { ...pad(), adviceLines: ['Changed in another window'] };
    const response = await patch();
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('another window');
    expect(mocks.current).toHaveBeenCalledOnce();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it('distinguishes an explicitly empty preview from a now-populated pad', async () => {
    expect((await patch({ expectedPad: null, ops: [operation] })).status).toBe(409);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('refuses mutation when signing wins between preflight and acquiring the session lock', async () => {
    current.therapyNote = { signedAt: new Date('2026-09-25T10:00:00Z'), locked: true };
    const response = await patch();
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('signed');
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it('allows a reopened prescription to be corrected while retaining its historical signedAt', async () => {
    current.therapyNote = { signedAt: new Date('2026-09-25T10:00:00Z'), locked: false };
    mocks.initial.mockResolvedValue(current);
    expect((await patch()).status).toBe(200);
    expect(mocks.update).toHaveBeenCalledOnce();
  });
  it.each(['replacement', 'ownership', 'missing'] as const)(
    'refuses a %s encountered during the locked reread',
    async (state) => {
      if (state === 'replacement') current.noteDraft!.id = 'new-draft';
      if (state === 'ownership') current.psychologistId = 'other-doctor';
      if (state === 'missing') current.noteDraft = null;
      expect((await patch()).status).toBe(409);
      expect(mocks.update).not.toHaveBeenCalled();
      expect(mocks.audit).not.toHaveBeenCalled();
    },
  );
  it('preserves client→session→draft lock order before comparing or writing, and audits inside the transaction', async () => {
    const response = await patch();
    expect(response.status).toBe(200);
    const queries = mocks.query.mock.calls.map(([strings]) =>
      (strings as TemplateStringsArray).join('?'),
    );
    expect(queries[0]).toContain('FROM "clients"');
    expect(queries[1]).toContain('FROM "sessions"');
    expect(queries[2]).toContain('FROM "note_drafts"');
    expect(mocks.current.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.query.mock.invocationCallOrder[2],
    );
    expect(mocks.update.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.current.mock.invocationCallOrder[0],
    );
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'draft-1' },
      data: { rxPad: expect.objectContaining({ adviceLines: ['Fictional reviewed advice'] }) },
    });
    expect(mocks.audit.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ noteDraft: { update: mocks.update } }),
    );
  });
  it('allows canonical-equivalent property order and retains newer rows for legacy unbound callers', async () => {
    const original = pad();
    expect(
      (
        await patch({
          expectedPad: {
            adviceLines: original.adviceLines,
            meds: original.meds,
            version: original.version,
          },
          ops: [operation],
        })
      ).status,
    ).toBe(200);
    current.noteDraft!.rxPad = { ...pad(), adviceLines: ['More recent clinician advice'] };
    const response = await patch({ ops: [operation] });
    expect(response.status).toBe(200);
    expect((await response.json()).rxPad.adviceLines).toEqual([
      'More recent clinician advice',
      'Fictional reviewed advice',
    ]);
  });
  it('refuses after erasure takes the client lock', async () => {
    mocks.query.mockResolvedValue([]);
    expect((await patch()).status).toBe(404);
    expect(mocks.current).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
