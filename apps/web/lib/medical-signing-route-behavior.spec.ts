import { createHash } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { canonicalJson, canonicalSigningPayload } from './sign-note-payload';

const mocks = vi.hoisted(() => ({
  signableKind: 'MEDICAL' as 'MEDICAL' | 'THERAPY',
  requirePsychologistId: vi.fn(),
  requireCapability: vi.fn(),
  parseJson: vi.fn(),
  writeAudit: vi.fn(),
  sessionFindUnique: vi.fn(),
  webAuthnFindMany: vi.fn(),
  draftFindUnique: vi.fn(),
  noteFindUnique: vi.fn(),
  persistedEdits: vi.fn(),
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  executeRaw: vi.fn(),
  noteCreate: vi.fn(),
  noteUpdate: vi.fn(),
  signatureVersionCreate: vi.fn(),
  editsCreateMany: vi.fn(),
  webAuthnUpdate: vi.fn(),
  noteSafeParse: vi.fn(),
  rxSafeParse: vi.fn(),
}));

vi.mock('@cureocity/contracts', () => {
  const passthrough = { safeParse: mocks.noteSafeParse };
  return {
    IntakeNoteV1Schema: passthrough,
    MedicalEncounterNoteV1Schema: passthrough,
    TherapyNoteV1Schema: passthrough,
    SignNoteInputSchema: passthrough,
    RxPadV1Schema: { safeParse: mocks.rxSafeParse },
  };
});
vi.mock('./auth-server', () => ({
  isAuthBypassed: () => false,
  requirePsychologistId: mocks.requirePsychologistId,
  requireCapability: mocks.requireCapability,
}));
vi.mock('./audit', () => ({
  auditMetadataFromRequest: () => ({ requestId: 'request-1' }),
  writeAudit: mocks.writeAudit,
}));
vi.mock('./note-edit-fields', () => ({
  SIGNABLE_FIELDS_BY_KIND: { MEDICAL: [], THERAPY: [] },
  signableKindFor: () => mocks.signableKind,
}));
vi.mock('./validate', () => ({ parseJson: mocks.parseJson }));
vi.mock('./webauthn-verify', () => ({
  resolveAllowedOrigins: () => ['https://example.test'],
  verifyNoteSigningAssertion: vi.fn(),
}));
vi.mock('./prisma', () => ({
  prisma: {
    session: { findUnique: mocks.sessionFindUnique },
    webAuthnCredential: { findMany: mocks.webAuthnFindMany },
    noteDraft: { findUnique: mocks.draftFindUnique },
    therapyNote: { findUnique: mocks.noteFindUnique },
    noteEdit: { findMany: mocks.persistedEdits },
    $transaction: mocks.transaction,
  },
}));

import { POST } from '../app/api/v1/sessions/[id]/sign/route';

const auth = {
  ok: true as const,
  value: {
    psychologistId: 'psy-1',
    user: { firebaseUid: 'uid-1', psychologistId: 'psy-1' },
  },
};

const finalNote = { version: 'V1' };
const draftContentHashHex = createHash('sha256').update(canonicalJson(finalNote)).digest('hex');
const payload = canonicalSigningPayload({
  sessionId: 'session-1',
  draftContentHashHex,
  note: finalNote,
  edits: [],
  signedAt: '2026-08-18T12:00:00.000Z',
  safetyOverride: undefined,
  rxPad: null,
});
const payloadHashHex = createHash('sha256').update(payload).digest('hex');

function request() {
  return new Request('https://example.test/api/v1/sessions/session-1/sign', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
}

const tx = {
  $queryRaw: mocks.queryRaw,
  $executeRaw: mocks.executeRaw,
  therapyNote: { create: mocks.noteCreate, update: mocks.noteUpdate },
  noteSignatureVersion: { create: mocks.signatureVersionCreate },
  noteEdit: { createMany: mocks.editsCreateMany },
  webAuthnCredential: { update: mocks.webAuthnUpdate },
};

function sqlText(strings: TemplateStringsArray): string {
  return Array.from(strings).join('?');
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-18T12:00:00.000Z'));
  vi.clearAllMocks();
  mocks.signableKind = 'MEDICAL';
  mocks.requirePsychologistId.mockResolvedValue(auth);
  mocks.requireCapability.mockResolvedValue(auth);
  mocks.noteSafeParse.mockImplementation((value) => ({ success: true, data: value }));
  mocks.rxSafeParse.mockReturnValue({ success: false });
  mocks.parseJson.mockResolvedValue({
    ok: true,
    value: {
      payload,
      payloadHashHex,
      note: finalNote,
      edits: [],
      signedAt: '2026-08-18T12:00:00.000Z',
    },
  });
  mocks.sessionFindUnique.mockResolvedValue({
    psychologistId: 'psy-1',
    status: 'COMPLETED',
    kind: 'TREATMENT',
    psychologist: { vertical: 'DOCTOR' },
  });
  mocks.webAuthnFindMany.mockResolvedValue([]);
  mocks.draftFindUnique.mockResolvedValue({
    id: 'draft-1',
    status: 'COMPLETED',
    content: finalNote,
    rxPad: null,
  });
  mocks.noteFindUnique.mockResolvedValue(null);
  mocks.persistedEdits.mockResolvedValue([]);
  mocks.noteCreate.mockImplementation(({ data }) =>
    Promise.resolve({
      id: 'note-1',
      ...data,
      createdAt: new Date('2026-08-18T12:00:00.000Z'),
      signCredentialId: null,
      signChallengeHashHex: payloadHashHex,
    }),
  );
  mocks.transaction.mockImplementation((callback) => callback(tx));
  mocks.queryRaw.mockImplementation((strings: TemplateStringsArray) => {
    const sql = sqlText(strings);
    if (sql.includes('FROM "clients" c')) {
      return Promise.resolve([{ id: 'client-1', psychologistId: 'psy-1' }]);
    }
    if (sql.includes('FROM "psychologists"')) {
      return Promise.resolve([
        {
          id: 'psy-1',
          vertical: 'DOCTOR',
          profession: 'PHYSICIAN',
          status: 'ACTIVE',
          deletedAt: null,
        },
      ]);
    }
    if (sql.includes('FROM "practitioner_credentials"')) {
      return Promise.resolve([
        {
          id: 'credential-1',
          psychologistId: 'psy-1',
          kind: 'NMC_REGISTRATION',
          registrationNumber: ' NMC-123 ',
          issuingAuthority: ' National Medical Commission ',
          jurisdiction: 'IN',
          status: 'VERIFIED',
          verifiedAt: new Date('2026-01-01T00:00:00.000Z'),
          expiresAt: null,
        },
      ]);
    }
    if (sql.includes('FROM "practitioner_capability_grants"')) {
      return Promise.resolve([
        {
          capability: 'PRESCRIPTION_DRAFTING',
          source: 'ADMIN_OVERRIDE',
          active: true,
          revokedAt: null,
        },
      ]);
    }
    if (sql.includes('FROM "sessions"')) {
      return Promise.resolve([
        {
          id: 'session-1',
          psychologistId: 'psy-1',
          status: 'COMPLETED',
          kind: 'TREATMENT',
          vertical: 'DOCTOR',
        },
      ]);
    }
    if (sql.includes('FROM "note_drafts"')) {
      return Promise.resolve([
        {
          id: 'draft-1',
          status: 'COMPLETED',
          content: finalNote,
          rxPad: null,
        },
      ]);
    }
    if (sql.includes('FROM "therapy_notes"')) return Promise.resolve([]);
    if (sql.includes('FROM "webauthn_credentials"')) return Promise.resolve([]);
    return Promise.resolve([]);
  });
});

afterAll(() => vi.useRealTimers());

describe('medical signing route transaction behavior', () => {
  it.each([
    ['stale', '2026-08-18T11:54:59.999Z'],
    ['future', '2026-08-18T12:05:00.001Z'],
  ])(
    'rejects a %s client timestamp outside the five-minute receipt window',
    async (_, signedAt) => {
      const skewedPayload = canonicalSigningPayload({
        sessionId: 'session-1',
        draftContentHashHex,
        note: finalNote,
        edits: [],
        signedAt,
        safetyOverride: undefined,
        rxPad: null,
      });
      mocks.parseJson.mockResolvedValue({
        ok: true,
        value: {
          payload: skewedPayload,
          payloadHashHex: createHash('sha256').update(skewedPayload).digest('hex'),
          note: finalNote,
          edits: [],
          signedAt,
        },
      });
      const response = await POST(request() as never, {
        params: Promise.resolve({ id: 'session-1' }),
      });
      expect(response.status).toBe(409);
      expect(mocks.noteCreate).not.toHaveBeenCalled();
    },
  );

  it('stores server receipt time while retaining bounded client time in proof and audit', async () => {
    const clientSignedAt = '2026-08-18T11:59:00.000Z';
    const clientPayload = canonicalSigningPayload({
      sessionId: 'session-1',
      draftContentHashHex,
      note: finalNote,
      edits: [],
      signedAt: clientSignedAt,
      safetyOverride: undefined,
      rxPad: null,
    });
    mocks.parseJson.mockResolvedValue({
      ok: true,
      value: {
        payload: clientPayload,
        payloadHashHex: createHash('sha256').update(clientPayload).digest('hex'),
        note: finalNote,
        edits: [],
        signedAt: clientSignedAt,
      },
    });
    const response = await POST(request() as never, {
      params: Promise.resolve({ id: 'session-1' }),
    });
    expect(response.status).toBe(201);
    expect(mocks.noteCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        signedAt: new Date('2026-08-18T12:00:00.000Z'),
        signPayload: clientPayload,
      }),
    });
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          clientSignedAt,
          serverReceivedAt: '2026-08-18T12:00:00.000Z',
        }),
      }),
      tx,
    );
  });
  it('takes every authoritative signing read inside the transaction under row locks', async () => {
    const response = await POST(request() as never, {
      params: Promise.resolve({ id: 'session-1' }),
    });

    expect(response.status).toBe(201);
    expect(mocks.sessionFindUnique).not.toHaveBeenCalled();
    expect(mocks.webAuthnFindMany).not.toHaveBeenCalled();
    expect(mocks.draftFindUnique).not.toHaveBeenCalled();
    expect(mocks.noteFindUnique).not.toHaveBeenCalled();
    const lockedSql = mocks.queryRaw.mock.calls.map(([strings]) => sqlText(strings));
    expect(lockedSql).toEqual(
      expect.arrayContaining([
        expect.stringContaining('FROM "sessions"'),
        expect.stringContaining('FROM "note_drafts"'),
        expect.stringContaining('FROM "therapy_notes"'),
        expect.stringContaining('FROM "webauthn_credentials"'),
      ]),
    );
    for (const sql of lockedSql) expect(sql).toContain('FOR UPDATE');
  });

  it('persists exact medical authority provenance with note and audit in one transaction', async () => {
    const response = await POST(request() as never, {
      params: Promise.resolve({ id: 'session-1' }),
    });

    expect(response.status).toBe(201);
    expect(mocks.noteCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        medicalSigningCredentialId: 'credential-1',
        medicalSigningCredentialSnapshot: {
          id: 'credential-1',
          kind: 'NMC_REGISTRATION',
          registrationNumber: 'NMC-123',
          issuingAuthority: 'National Medical Commission',
          jurisdiction: 'IN',
          verifiedAt: '2026-01-01T00:00:00.000Z',
          expiresAt: null,
        },
      }),
    });
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ENCOUNTER_NOTE_SIGNED',
        metadata: expect.objectContaining({
          medicalSigningCredentialId: 'credential-1',
          medicalSigningCredentialKind: 'NMC_REGISTRATION',
        }),
      }),
      tx,
    );
  });

  it('rolls back before note mutation when locked credential evidence is no longer valid', async () => {
    const baseQuery = mocks.queryRaw.getMockImplementation()!;
    mocks.queryRaw.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = sqlText(strings);
      if (sql.includes('FROM "practitioner_credentials"')) return Promise.resolve([]);
      return baseQuery(strings, ...values);
    });

    const response = await POST(request() as never, {
      params: Promise.resolve({ id: 'session-1' }),
    });

    expect(response.status).toBe(403);
    expect(mocks.noteCreate).not.toHaveBeenCalled();
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });

  it('snapshots prior signature proof before updating a re-signed note', async () => {
    const prior = {
      id: 'note-1',
      locked: false,
      version: 'V1',
      content: finalNote,
      rxPad: { meds: [] },
      signedAt: new Date('2026-08-17T12:00:00.000Z'),
      signedBy: 'psy-1',
      signCredentialId: 'passkey-old',
      signClientDataJsonB64u: 'client-old',
      signAuthenticatorDataB64u: 'auth-old',
      signSignatureB64u: 'signature-old',
      signChallengeHashHex: 'c'.repeat(64),
      signPayload: payload,
      medicalSigningCredentialId: 'medical-old',
      medicalSigningCredentialSnapshot: { registrationNumber: 'OLD-1' },
    };
    const baseQuery = mocks.queryRaw.getMockImplementation()!;
    mocks.queryRaw.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) =>
      sqlText(strings).includes('FROM "therapy_notes"')
        ? Promise.resolve([prior])
        : baseQuery(strings, ...values),
    );
    mocks.noteUpdate.mockResolvedValue({
      id: 'note-1',
      sessionId: 'session-1',
      draftId: 'draft-1',
      version: 'V1',
      content: finalNote,
      signedAt: new Date('2026-08-18T12:00:00.000Z'),
      signedBy: 'psy-1',
      createdAt: new Date('2026-08-17T12:00:00.000Z'),
      signCredentialId: null,
      signChallengeHashHex: payloadHashHex,
    });

    const response = await POST(request() as never, {
      params: Promise.resolve({ id: 'session-1' }),
    });

    expect(response.status).toBe(201);
    expect(mocks.signatureVersionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        therapyNoteId: 'note-1',
        version: 'V1',
        content: finalNote,
        rxPad: { meds: [] },
        signedAt: prior.signedAt,
        signedBy: 'psy-1',
        signCredentialId: 'passkey-old',
        signClientDataJsonB64u: 'client-old',
        signAuthenticatorDataB64u: 'auth-old',
        signSignatureB64u: 'signature-old',
        signChallengeHashHex: 'c'.repeat(64),
        signPayload: payload,
        medicalSigningCredentialId: 'medical-old',
        medicalSigningCredentialSnapshot: { registrationNumber: 'OLD-1' },
        contentHashHex: createHash('sha256').update(canonicalJson(finalNote)).digest('hex'),
      }),
    });
    expect(mocks.signatureVersionCreate.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.noteUpdate.mock.invocationCallOrder[0]!,
    );
  });

  it('rejects a malformed non-null locked Rx instead of signing it as null', async () => {
    const baseQuery = mocks.queryRaw.getMockImplementation()!;
    mocks.queryRaw.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) =>
      sqlText(strings).includes('FROM "note_drafts"')
        ? Promise.resolve([
            { id: 'draft-1', status: 'COMPLETED', content: finalNote, rxPad: { bad: true } },
          ])
        : baseQuery(strings, ...values),
    );

    const response = await POST(request() as never, {
      params: Promise.resolve({ id: 'session-1' }),
    });

    expect(response.status).toBe(409);
    expect(mocks.noteCreate).not.toHaveBeenCalled();
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });

  it('maps an invalid locked draft to 409 and rolls back', async () => {
    mocks.noteSafeParse.mockReturnValueOnce({ success: false, error: new Error('bad draft') });

    const response = await POST(request() as never, {
      params: Promise.resolve({ id: 'session-1' }),
    });

    expect(response.status).toBe(409);
    expect(mocks.noteCreate).not.toHaveBeenCalled();
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });

  it('maps an invalid submitted kind-specific note to 400 and rolls back', async () => {
    mocks.noteSafeParse
      .mockReturnValueOnce({ success: true, data: finalNote })
      .mockReturnValueOnce({ success: false, error: new Error('wrong shape') });

    const response = await POST(request() as never, {
      params: Promise.resolve({ id: 'session-1' }),
    });

    expect(response.status).toBe(400);
    expect(mocks.noteCreate).not.toHaveBeenCalled();
  });

  it('maps an invalid prior signed note to 409 without overwriting its history', async () => {
    const baseQuery = mocks.queryRaw.getMockImplementation()!;
    mocks.queryRaw.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) =>
      sqlText(strings).includes('FROM "therapy_notes"')
        ? Promise.resolve([
            {
              id: 'note-1',
              locked: false,
              version: 'V1',
              content: { malformed: true },
              rxPad: null,
              signedAt: new Date('2026-08-17T12:00:00.000Z'),
              signedBy: 'psy-1',
              signCredentialId: null,
              signClientDataJsonB64u: null,
              signAuthenticatorDataB64u: null,
              signSignatureB64u: null,
              signChallengeHashHex: null,
              signPayload: null,
              medicalSigningCredentialId: null,
              medicalSigningCredentialSnapshot: null,
            },
          ])
        : baseQuery(strings, ...values),
    );
    mocks.noteSafeParse
      .mockReturnValueOnce({ success: true, data: finalNote })
      .mockReturnValueOnce({ success: true, data: finalNote })
      .mockReturnValueOnce({ success: false, error: new Error('bad prior note') });

    const response = await POST(request() as never, {
      params: Promise.resolve({ id: 'session-1' }),
    });

    expect(response.status).toBe(409);
    expect(mocks.signatureVersionCreate).not.toHaveBeenCalled();
    expect(mocks.noteUpdate).not.toHaveBeenCalled();
  });

  it('stores only bounded codes, counts, hashes, and references for safety-override audit metadata', async () => {
    const safetyOverride = {
      reasonCode: 'CLINICAL_JUDGMENT',
      reason: 'private patient-specific rationale',
      blockers: ['private allergy text'],
    };
    const overridePayload = canonicalSigningPayload({
      sessionId: 'session-1',
      draftContentHashHex,
      note: finalNote,
      edits: [],
      signedAt: '2026-08-18T12:00:00.000Z',
      safetyOverride,
      rxPad: null,
    });
    mocks.parseJson.mockResolvedValue({
      ok: true,
      value: {
        payload: overridePayload,
        payloadHashHex: createHash('sha256').update(overridePayload).digest('hex'),
        note: finalNote,
        edits: [],
        signedAt: '2026-08-18T12:00:00.000Z',
        safetyOverride,
      },
    });

    const response = await POST(request() as never, {
      params: Promise.resolve({ id: 'session-1' }),
    });

    expect(response.status).toBe(201);
    const overrideAudit = mocks.writeAudit.mock.calls.find(
      ([entry]) => entry.action === 'RX_SAFETY_OVERRIDE',
    )?.[0];
    expect(overrideAudit.metadata).toEqual(
      expect.objectContaining({
        reasonCode: 'CLINICAL_JUDGMENT',
        reasonHashHex: createHash('sha256').update(safetyOverride.reason).digest('hex'),
        blockerCount: 1,
        blockerHashes: [createHash('sha256').update(safetyOverride.blockers[0]).digest('hex')],
        signedNoteId: 'note-1',
      }),
    );
    const serialized = JSON.stringify(overrideAudit.metadata);
    expect(serialized).not.toContain(safetyOverride.reason);
    expect(serialized).not.toContain(safetyOverride.blockers[0]);
  });

  it('keeps therapy signing capability-free with null medical provenance', async () => {
    mocks.signableKind = 'THERAPY';

    const response = await POST(request() as never, {
      params: Promise.resolve({ id: 'session-1' }),
    });

    expect(response.status).toBe(201);
    expect(mocks.requireCapability).not.toHaveBeenCalled();
    const lockedSql = mocks.queryRaw.mock.calls.map(([strings]) => sqlText(strings));
    expect(lockedSql).toHaveLength(5);
    expect(lockedSql[0]).toContain('FROM "clients" c');
    for (const sql of lockedSql) expect(sql).toContain('FOR UPDATE');
    expect(lockedSql.some((sql) => sql.includes('FROM "practitioner_credentials"'))).toBe(false);
    expect(mocks.noteCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        medicalSigningCredentialId: null,
        medicalSigningCredentialSnapshot: expect.anything(),
        rxPad: expect.anything(),
      }),
    });
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'NOTE_SIGNED' }),
      tx,
    );
  });
});
