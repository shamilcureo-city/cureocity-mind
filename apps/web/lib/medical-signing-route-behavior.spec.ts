import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  noteCreate: vi.fn(),
  noteUpdate: vi.fn(),
  editsCreateMany: vi.fn(),
  webAuthnUpdate: vi.fn(),
}));

vi.mock('@cureocity/contracts', () => {
  const passthrough = { parse: (value: unknown) => value };
  return {
    IntakeNoteV1Schema: passthrough,
    MedicalEncounterNoteV1Schema: passthrough,
    TherapyNoteV1Schema: passthrough,
    SignNoteInputSchema: passthrough,
    RxPadV1Schema: { safeParse: () => ({ success: false }) },
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
const payload = JSON.stringify(finalNote);
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
  therapyNote: { create: mocks.noteCreate, update: mocks.noteUpdate },
  noteEdit: { createMany: mocks.editsCreateMany },
  webAuthnCredential: { update: mocks.webAuthnUpdate },
};

function sqlText(strings: TemplateStringsArray): string {
  return Array.from(strings).join('?');
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.signableKind = 'MEDICAL';
  mocks.requirePsychologistId.mockResolvedValue(auth);
  mocks.requireCapability.mockResolvedValue(auth);
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
    return Promise.resolve([]);
  });
});

describe('medical signing route transaction behavior', () => {
  it('persists exact medical authority provenance with note and audit in one transaction', async () => {
    const response = await POST(request() as never, {
      params: Promise.resolve({ id: 'session-1' }),
    });

    expect(response.status).toBe(201);
    expect(mocks.requireCapability).toHaveBeenCalledWith(
      expect.anything(),
      'PRESCRIPTION_SIGNING',
      auth,
    );
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
    mocks.queryRaw.mockImplementation((strings: TemplateStringsArray) => {
      const sql = sqlText(strings);
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
      return Promise.resolve([]);
    });

    const response = await POST(request() as never, {
      params: Promise.resolve({ id: 'session-1' }),
    });

    expect(response.status).toBe(403);
    expect(mocks.noteCreate).not.toHaveBeenCalled();
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });

  it('keeps therapy signing capability-free with null medical provenance', async () => {
    mocks.signableKind = 'THERAPY';

    const response = await POST(request() as never, {
      params: Promise.resolve({ id: 'session-1' }),
    });

    expect(response.status).toBe(201);
    expect(mocks.requireCapability).not.toHaveBeenCalled();
    expect(mocks.queryRaw).not.toHaveBeenCalled();
    expect(mocks.noteCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        medicalSigningCredentialId: null,
      }),
    });
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'NOTE_SIGNED' }),
      tx,
    );
  });
});
