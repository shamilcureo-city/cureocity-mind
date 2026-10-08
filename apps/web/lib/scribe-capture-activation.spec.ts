import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({
  find: vi.fn(),
  transition: vi.fn(),
  consent: vi.fn(),
  teleconsult: vi.fn(),
  capabilities: vi.fn(),
  audit: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock('./prisma', () => ({ prisma: { $transaction: m.transaction } }));
vi.mock('./consent-gate', () => ({
  assertValidScribeConsent: m.consent,
  withClientConsentLock: async (_tx: unknown, _id: string, action: () => unknown) => action(),
}));
vi.mock('./capabilities', () => ({
  getEffectiveCapabilities: m.capabilities,
  serializeCapabilities: (value: { capabilities: Set<string> }) => [...value.capabilities],
}));
vi.mock('./scribe-teleconsult', () => ({
  assertScribeTeleconsultDocumentationConsent: m.teleconsult,
}));
vi.mock('./session-transition', () => ({ conditionalSessionTransition: m.transition }));
vi.mock('./audit', () => ({ writeAudit: m.audit }));
import { authorizeScribeCapturePreparation } from './scribe-capture-activation';

const input = () => ({
  sessionId: 'session-1',
  psychologistId: 'doctor-1',
  vertical: 'DOCTOR' as const,
  tokenExpiresAt: Math.floor(Date.now() / 1000) + 300,
  purpose: 'capture-activation' as const,
});
const row = () => ({
  clientId: 'patient-1',
  psychologistId: 'doctor-1',
  status: 'SCHEDULED',
  captureMode: 'LIVE',
  mindDocumentationMode: null,
  consentSnapshot: { captureMode: 'LIVE' },
  client: { deletedAt: null },
  psychologist: { vertical: 'DOCTOR' },
});
beforeEach(() => {
  vi.resetAllMocks();
  m.transaction.mockImplementation((run) => run({ session: { findUnique: m.find } }));
  m.find.mockImplementation(async () => row());
  m.capabilities.mockResolvedValue({
    capabilities: new Set(['LIVE_ENCOUNTER', 'MEDICAL_DOCUMENTATION']),
  });
});
describe('trusted Scribe first-audio activation', () => {
  it('does not start or consume a consultation during preflight', async () => {
    await authorizeScribeCapturePreparation({ ...input(), purpose: 'preflight' });
    expect(m.transition).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
    expect(m.consent).toHaveBeenCalled();
    expect(m.teleconsult).toHaveBeenCalled();
  });
  it('starts only after all current authority checks pass', async () => {
    await authorizeScribeCapturePreparation(input());
    expect(m.transition).toHaveBeenCalledWith(expect.anything(), {
      sessionId: 'session-1',
      expectedStatus: 'SCHEDULED',
      data: { status: 'IN_PROGRESS', startedAt: expect.any(Date) },
    });
    expect(m.consent.mock.invocationCallOrder[0]).toBeLessThan(
      m.transition.mock.invocationCallOrder[0]!,
    );
    expect(m.capabilities.mock.invocationCallOrder[0]).toBeLessThan(
      m.transition.mock.invocationCallOrder[0]!,
    );
    expect(m.audit).toHaveBeenCalledOnce();
  });
  it('does not charge again on reconnect', async () => {
    m.find.mockResolvedValue({ ...row(), status: 'IN_PROGRESS' });
    await authorizeScribeCapturePreparation(input());
    expect(m.transition).not.toHaveBeenCalled();
  });
  it.each([
    { status: 'COMPLETED' },
    { status: 'CANCELLED' },
    { status: 'RESCHEDULED' },
    { captureMode: 'DICTATE' },
    { captureMode: 'UPLOAD' },
    { captureMode: null },
    { psychologistId: 'other-doctor' },
    { client: { deletedAt: new Date() } },
    { client: null },
    { psychologist: { vertical: 'THERAPIST' } },
    { mindDocumentationMode: 'MANUAL' },
    { consentSnapshot: { captureMode: 'LIVE', ambientCaptureDeclined: true } },
    { consentSnapshot: { captureMode: 'DICTATE' } },
  ])('never activates an invalid or refused session: %o', async (patch) => {
    m.find.mockResolvedValue({ ...row(), ...patch });
    await expect(authorizeScribeCapturePreparation(input())).rejects.toThrow();
    expect(m.transition).not.toHaveBeenCalled();
  });
  it.each(['consent', 'teleconsult', 'capabilities'] as const)(
    'fails closed if %s check fails',
    async (check) => {
      m[check].mockRejectedValue(new Error('denied'));
      await expect(authorizeScribeCapturePreparation(input())).rejects.toThrow();
      expect(m.transition).not.toHaveBeenCalled();
    },
  );
  it.each(['LIVE_ENCOUNTER', 'MEDICAL_DOCUMENTATION'])(
    'requires %s before activation',
    async (missing) => {
      m.capabilities.mockResolvedValue({
        capabilities: new Set(
          ['LIVE_ENCOUNTER', 'MEDICAL_DOCUMENTATION'].filter((x) => x !== missing),
        ),
      });
      await expect(authorizeScribeCapturePreparation(input())).rejects.toThrow();
      expect(m.transition).not.toHaveBeenCalled();
    },
  );
  it('never accepts an expired lease', async () => {
    await expect(
      authorizeScribeCapturePreparation({ ...input(), tokenExpiresAt: 1 }),
    ).rejects.toThrow();
    expect(m.transition).not.toHaveBeenCalled();
  });
  it('does not modify Mind capture', async () => {
    await expect(
      authorizeScribeCapturePreparation({ ...input(), vertical: 'THERAPIST' }),
    ).rejects.toThrow();
    expect(m.transaction).not.toHaveBeenCalled();
  });
  it('does not audit a start when conditional transition loses a race', async () => {
    m.transition.mockRejectedValue(new Error('concurrent change'));
    await expect(authorizeScribeCapturePreparation(input())).rejects.toThrow();
    expect(m.audit).not.toHaveBeenCalled();
  });
});
