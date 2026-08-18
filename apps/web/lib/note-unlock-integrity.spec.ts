import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { canonicalJson, canonicalSigningPayload } from './sign-note-payload';

const mocks = vi.hoisted(() => ({
  requirePsychologistId: vi.fn(),
  writeAudit: vi.fn(),
  sessionFindUnique: vi.fn(),
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  signatureVersionCreate: vi.fn(),
  noteUpdate: vi.fn(),
  draftUpdate: vi.fn(),
}));

vi.mock('./auth-server', () => ({ requirePsychologistId: mocks.requirePsychologistId }));
vi.mock('./audit', () => ({
  auditMetadataFromRequest: () => ({ requestId: 'request-1' }),
  writeAudit: mocks.writeAudit,
}));
vi.mock('./prisma', () => ({
  prisma: {
    session: { findUnique: mocks.sessionFindUnique },
    $transaction: mocks.transaction,
  },
}));

import { POST } from '../app/api/v1/sessions/[id]/note/unlock/route';

const noteContent = { version: 'V1', chiefComplaint: 'private complaint' };
const rxPad = { meds: [{ drug: 'private drug', status: 'confirmed' }] };
const signedAt = new Date('2026-08-17T12:00:00.000Z');
const signPayload = canonicalSigningPayload({
  sessionId: 'session-1',
  draftContentHashHex: 'a'.repeat(64),
  note: noteContent,
  edits: [],
  signedAt: signedAt.toISOString(),
  safetyOverride: {
    reasonCode: 'CLINICAL_JUDGMENT',
    reason: 'private rationale',
    blockers: ['private allergy'],
  },
  rxPad,
});
const signChallengeHashHex = createHash('sha256').update(signPayload).digest('hex');

const lockedNote = {
  id: 'note-1',
  draftId: 'draft-1',
  locked: true,
  version: 'V1',
  content: noteContent,
  rxPad,
  signedAt,
  signedBy: 'psy-1',
  signCredentialId: 'credential-external-id',
  signClientDataJsonB64u: 'client-data',
  signAuthenticatorDataB64u: 'auth-data',
  signSignatureB64u: 'signature',
  signChallengeHashHex,
  signPayload,
  medicalSigningCredentialId: 'medical-1',
  medicalSigningCredentialSnapshot: { registrationNumber: 'NMC-1' },
};

const tx = {
  $queryRaw: mocks.queryRaw,
  noteSignatureVersion: { create: mocks.signatureVersionCreate },
  therapyNote: { update: mocks.noteUpdate },
  noteDraft: { update: mocks.draftUpdate },
};

function sqlText(strings: TemplateStringsArray): string {
  return Array.from(strings).join('?');
}

function request() {
  return new Request('https://example.test/api/v1/sessions/session-1/note/unlock', {
    method: 'POST',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requirePsychologistId.mockResolvedValue({
    ok: true,
    value: { psychologistId: 'psy-1' },
  });
  mocks.transaction.mockImplementation((callback) => callback(tx));
  mocks.queryRaw.mockImplementation((strings: TemplateStringsArray) => {
    const sql = sqlText(strings);
    if (sql.includes('FROM "clients" c')) {
      return Promise.resolve([{ id: 'client-1', psychologistId: 'psy-1' }]);
    }
    if (sql.includes('FROM "sessions"')) {
      return Promise.resolve([{ id: 'session-1', psychologistId: 'psy-1' }]);
    }
    if (sql.includes('FROM "note_drafts"')) return Promise.resolve([{ id: 'draft-1' }]);
    if (sql.includes('FROM "therapy_notes"')) return Promise.resolve([lockedNote]);
    if (sql.includes('FROM "webauthn_credentials"')) {
      return Promise.resolve([{ id: 'webauthn-row-1', credentialId: 'credential-external-id' }]);
    }
    return Promise.resolve([]);
  });
  mocks.noteUpdate.mockResolvedValue({ id: 'note-1' });
  mocks.draftUpdate.mockResolvedValue({ id: 'draft-1' });
  mocks.signatureVersionCreate.mockResolvedValue({ id: 'version-1' });
});

describe('signed-note unlock integrity', () => {
  it('locks authoritative rows in signing order without stale pre-transaction reads', async () => {
    const response = await POST(request() as never, {
      params: Promise.resolve({ id: 'session-1' }),
    });

    expect(response.status).toBe(200);
    expect(mocks.sessionFindUnique).not.toHaveBeenCalled();
    const lockedSql = mocks.queryRaw.mock.calls.map(([strings]) => sqlText(strings));
    expect(lockedSql.map((sql) => sql.match(/FROM "([^"]+)"/)?.[1])).toEqual([
      'clients',
      'sessions',
      'note_drafts',
      'therapy_notes',
      'webauthn_credentials',
    ]);
    for (const sql of lockedSql) expect(sql).toContain('FOR UPDATE');
  });

  it('archives the exact payload-bound content, Rx, and proof before unlocking', async () => {
    const response = await POST(request() as never, {
      params: Promise.resolve({ id: 'session-1' }),
    });

    expect(response.status).toBe(200);
    expect(mocks.signatureVersionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        therapyNoteId: 'note-1',
        version: 'V1',
        content: noteContent,
        contentHashHex: createHash('sha256').update(canonicalJson(noteContent)).digest('hex'),
        rxPad,
        signedAt,
        signedBy: 'psy-1',
        signCredentialId: 'credential-external-id',
        signClientDataJsonB64u: 'client-data',
        signAuthenticatorDataB64u: 'auth-data',
        signSignatureB64u: 'signature',
        signChallengeHashHex,
        signPayload,
        medicalSigningCredentialId: 'medical-1',
        medicalSigningCredentialSnapshot: { registrationNumber: 'NMC-1' },
      }),
    });
    expect(mocks.signatureVersionCreate.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.noteUpdate.mock.invocationCallOrder[0]!,
    );
    expect(mocks.noteUpdate).toHaveBeenCalledWith({
      where: { id: 'note-1' },
      data: expect.objectContaining({
        locked: false,
        signCredentialId: null,
        signClientDataJsonB64u: null,
        signAuthenticatorDataB64u: null,
        signSignatureB64u: null,
        signChallengeHashHex: null,
        signPayload: null,
        medicalSigningCredentialId: null,
      }),
    });
    expect(mocks.draftUpdate).toHaveBeenCalledWith({
      where: { id: 'draft-1' },
      data: expect.objectContaining({ content: noteContent, rxPad, status: 'COMPLETED' }),
    });
  });

  it('fails closed with a stable conflict when stored proof does not bind the signed content', async () => {
    const baseQuery = mocks.queryRaw.getMockImplementation()!;
    mocks.queryRaw.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) =>
      sqlText(strings).includes('FROM "therapy_notes"')
        ? Promise.resolve([
            { ...lockedNote, content: { version: 'V1', chiefComplaint: 'tampered' } },
          ])
        : baseQuery(strings, ...values),
    );

    const response = await POST(request() as never, {
      params: Promise.resolve({ id: 'session-1' }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Signed note proof is incomplete or does not match the stored clinical version',
    });
    expect(mocks.signatureVersionCreate).not.toHaveBeenCalled();
    expect(mocks.noteUpdate).not.toHaveBeenCalled();
  });

  it('keeps audit metadata free of signed content, Rx, allergy blockers, and rationale', async () => {
    await POST(request() as never, { params: Promise.resolve({ id: 'session-1' }) });

    const metadata = mocks.writeAudit.mock.calls[0]?.[0]?.metadata;
    expect(metadata).toEqual(
      expect.objectContaining({ sessionId: 'session-1', archivedSignatureVersionId: 'version-1' }),
    );
    const serialized = JSON.stringify(metadata);
    for (const phi of [
      'private complaint',
      'private drug',
      'private allergy',
      'private rationale',
    ]) {
      expect(serialized).not.toContain(phi);
    }
  });
});
