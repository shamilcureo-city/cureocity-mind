import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import {
  PatientShareArtefactTypeSchema,
  ShareArtefactRefSchema,
  type PatientShareArtefactType,
  type PractitionerCapability,
  type ShareArtefactRef,
} from '@cureocity/contracts';

const mocks = vi.hoisted(() => ({
  requireCapability: vi.fn(),
  parseJson: vi.fn(),
  clientFindUnique: vi.fn(),
  transaction: vi.fn(),
  buildSnapshot: vi.fn(),
}));

vi.mock('./auth-server', () => ({ requireCapability: mocks.requireCapability }));
vi.mock('./validate', () => ({ parseJson: mocks.parseJson }));
vi.mock('./audit', () => ({ auditMetadataFromRequest: vi.fn(() => ({})), writeAudit: vi.fn() }));
vi.mock('./prisma', () => ({
  prisma: {
    client: { findUnique: mocks.clientFindUnique },
    patientShare: { findMany: vi.fn(async () => []) },
    $transaction: mocks.transaction,
  },
}));
vi.mock('./share-channels', () => ({ shareChannels: vi.fn() }));
vi.mock('./share-snapshots', () => ({
  buildSnapshot: mocks.buildSnapshot,
  SnapshotBuildError: class extends Error {},
}));
vi.mock('./share-translate', () => ({ translateForShare: vi.fn() }));
vi.mock('./watermark', () => ({ WATERMARK_TAGLINE: '', watermarkUrl: vi.fn() }));
vi.mock('./clinical-mappers', () => ({ toPatientShare: vi.fn() }));
vi.mock('./client-pii', () => ({ resolveClientPii: vi.fn() }));
vi.mock('./appointment-links', () => ({ publicBaseUrl: vi.fn(() => 'https://example.test') }));
vi.mock('./tenant-crypto', () => ({
  decryptForTenant: vi.fn(async () => null),
  encryptForTenant: vi.fn(async () => 'encrypted'),
}));
vi.mock('./share-recipient-envelope', () => ({
  decryptShareRecipientEnvelope: vi.fn(async () => null),
  encryptShareRecipientEnvelope: vi.fn(async () => 'encrypted-recipient'),
}));
vi.mock('./share-dispatch-safety', () => ({
  lockClientShareDispatch: vi.fn(),
  readWinningShareDispatch: vi.fn(),
  finalizeLeasedShare: vi.fn(),
}));

import { POST } from '../app/api/v1/share/route';

type Vertical = 'THERAPIST' | 'DOCTOR';
type PolicyCase = {
  artefact: ShareArtefactRef;
  vertical: Vertical;
  capabilities: readonly PractitionerCapability[];
};

const id = 'c123456789012345678901234';
const ARTEFACT_POLICY_CASES = {
  SIGNED_NOTE: {
    artefact: { artefactType: 'SIGNED_NOTE', sessionId: id },
    vertical: 'THERAPIST',
    capabilities: ['PATIENT_SHARING', 'BEHAVIORAL_HEALTH_DOCUMENTATION'],
  },
  REFLECTION_QUESTIONS: {
    artefact: { artefactType: 'REFLECTION_QUESTIONS', sessionId: id, questions: ['Reflect'] },
    vertical: 'THERAPIST',
    capabilities: ['PATIENT_SHARING', 'BEHAVIORAL_HEALTH_DOCUMENTATION'],
  },
  THERAPY_SCRIPT: {
    artefact: { artefactType: 'THERAPY_SCRIPT', therapyScriptId: id },
    vertical: 'THERAPIST',
    capabilities: ['PATIENT_SHARING', 'BEHAVIORAL_HEALTH_DOCUMENTATION'],
  },
  TREATMENT_PLAN: {
    artefact: { artefactType: 'TREATMENT_PLAN', treatmentPlanId: id },
    vertical: 'THERAPIST',
    capabilities: ['PATIENT_SHARING', 'BEHAVIORAL_HEALTH_DOCUMENTATION'],
  },
  PROGRESS_REPORT: {
    artefact: { artefactType: 'PROGRESS_REPORT', clientId: id },
    vertical: 'THERAPIST',
    capabilities: ['PATIENT_SHARING', 'BEHAVIORAL_HEALTH_DOCUMENTATION'],
  },
  INSTRUMENT_CHECKIN: {
    artefact: { artefactType: 'INSTRUMENT_CHECKIN', clientId: id, instrumentKey: 'PHQ9' },
    vertical: 'THERAPIST',
    capabilities: ['PATIENT_SHARING', 'BEHAVIORAL_HEALTH_DOCUMENTATION'],
  },
  SIGNED_INTAKE_NOTE: {
    artefact: { artefactType: 'SIGNED_INTAKE_NOTE', sessionId: id },
    vertical: 'THERAPIST',
    capabilities: ['PATIENT_SHARING', 'BEHAVIORAL_HEALTH_DOCUMENTATION'],
  },
  AFTER_VISIT_SUMMARY: {
    artefact: { artefactType: 'AFTER_VISIT_SUMMARY', sessionId: id },
    vertical: 'DOCTOR',
    capabilities: ['PATIENT_SHARING', 'MEDICAL_DOCUMENTATION'],
  },
  CHRONIC_PROGRESS_REPORT: {
    artefact: { artefactType: 'CHRONIC_PROGRESS_REPORT', clientId: id },
    vertical: 'DOCTOR',
    capabilities: ['PATIENT_SHARING', 'MEDICAL_DOCUMENTATION'],
  },
  RX_PAD: {
    artefact: { artefactType: 'RX_PAD', sessionId: id },
    vertical: 'DOCTOR',
    capabilities: ['PATIENT_SHARING', 'MEDICAL_DOCUMENTATION'],
  },
  HOMEWORK: {
    artefact: { artefactType: 'HOMEWORK', assignmentId: id },
    vertical: 'THERAPIST',
    capabilities: ['PATIENT_SHARING', 'BEHAVIORAL_HEALTH_DOCUMENTATION'],
  },
  SESSION_TAKEAWAY: {
    artefact: { artefactType: 'SESSION_TAKEAWAY', sessionId: id },
    vertical: 'THERAPIST',
    capabilities: ['PATIENT_SHARING', 'BEHAVIORAL_HEALTH_DOCUMENTATION'],
  },
} as const satisfies Record<PatientShareArtefactType, PolicyCase>;

const CASES = Object.entries(ARTEFACT_POLICY_CASES) as [PatientShareArtefactType, PolicyCase][];
const CAPABILITY_DENIAL_CASES = CASES.flatMap(([type, policy]) =>
  policy.capabilities.map(
    (missingCapability, missingIndex) => [type, policy, missingCapability, missingIndex] as const,
  ),
);
const deniedResponse = () =>
  NextResponse.json(
    { error: 'This account is not authorized for the requested clinical capability' },
    { status: 403 },
  );

function request() {
  return new Request('https://example.test/api/v1/share', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }) as never;
}

function arrangeAuth(vertical: Vertical, granted: readonly PractitionerCapability[]) {
  mocks.requireCapability.mockImplementation(
    async (_request: Request, capability: PractitionerCapability, prior?: unknown) =>
      granted.includes(capability)
        ? (prior ?? {
            ok: true,
            value: { psychologistId: 'psy-1', user: { vertical, capabilities: [...granted] } },
          })
        : { ok: false, response: deniedResponse() },
  );
}

function arrangeInput(artefact: ShareArtefactRef) {
  mocks.parseJson.mockResolvedValue({
    ok: true,
    value: { clientId: id, channels: ['PORTAL_LINK'], artefact },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.clientFindUnique.mockResolvedValue(null);
  mocks.transaction.mockResolvedValue([]);
});

describe('R2-04 exhaustive generic-share artefact authorization', () => {
  it('has exactly one policy row for every ShareArtefactRef discriminator', () => {
    const discriminators = ShareArtefactRefSchema.options.map(
      (option) => option.shape.artefactType.value,
    );
    expect([...Object.keys(ARTEFACT_POLICY_CASES)].sort()).toEqual([...discriminators].sort());
    expect([...PatientShareArtefactTypeSchema.options].sort()).toEqual([...discriminators].sort());
  });

  it.each(CASES)(
    '%s allows its vertical with exactly its least-required capabilities',
    async (_type, policy) => {
      arrangeInput(policy.artefact);
      arrangeAuth(policy.vertical, policy.capabilities);

      const response = await POST(request());

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: 'Client not found' });
      expect(mocks.requireCapability.mock.calls.map((call) => call[1])).toEqual(
        policy.capabilities,
      );
      expect(mocks.clientFindUnique).toHaveBeenCalledTimes(1);
      expect(mocks.buildSnapshot).not.toHaveBeenCalled();
    },
  );

  it.each(CAPABILITY_DENIAL_CASES)(
    '%s denies without %s before client/source reads',
    async (_type, policy, missingCapability, missingIndex) => {
      arrangeInput(policy.artefact);
      arrangeAuth(
        policy.vertical,
        policy.capabilities.filter((capability) => capability !== missingCapability),
      );

      const response = await POST(request());

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        error: 'This account is not authorized for the requested clinical capability',
      });
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(mocks.requireCapability.mock.calls.map((call) => call[1])).toEqual(
        policy.capabilities.slice(0, missingIndex + 1),
      );
      expect(mocks.clientFindUnique).not.toHaveBeenCalled();
      expect(mocks.buildSnapshot).not.toHaveBeenCalled();
    },
  );

  it.each(CASES)(
    '%s privately denies the wrong vertical before client/source reads',
    async (_type, policy) => {
      arrangeInput(policy.artefact);
      const wrongVertical: Vertical = policy.vertical === 'THERAPIST' ? 'DOCTOR' : 'THERAPIST';
      arrangeAuth(wrongVertical, policy.capabilities);

      const response = await POST(request());

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: 'Not found' });
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(mocks.requireCapability.mock.calls.map((call) => call[1])).toEqual(
        policy.capabilities,
      );
      expect(mocks.clientFindUnique).not.toHaveBeenCalled();
      expect(mocks.buildSnapshot).not.toHaveBeenCalled();
    },
  );
});
