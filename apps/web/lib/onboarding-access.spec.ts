import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
const h = vi.hoisted(() => ({
  identity: vi.fn(),
  exclusive: vi.fn(),
  activeGuard: vi.fn(),
  practitioner: vi.fn(),
}));
vi.mock('./auth-server', () => ({
  resolveFirebaseUidOnly: h.identity,
  assertUidAvailableForPractitioner: h.exclusive,
  requirePsychologistId: h.activeGuard,
}));
vi.mock('./prisma', () => ({ prisma: { psychologist: { findUnique: h.practitioner } } }));
import { requireOnboardingIdentity } from './onboarding-access';
const request = (host = 'scribe.cureocity.in') =>
  new Request(`https://${host}/api/v1/onboarding/complete`, { method: 'POST' }) as never;
beforeEach(() => {
  vi.clearAllMocks();
  h.identity.mockResolvedValue({ ok: true, value: 'original-uid' });
  h.exclusive.mockResolvedValue({ ok: true });
  h.practitioner.mockResolvedValue({
    id: 'owner',
    vertical: 'DOCTOR',
    status: 'PENDING_VERIFICATION',
    deletedAt: null,
  });
});
describe('limited Scribe registration access', () => {
  it('permits pending registration without granting clinical approval or capabilities', async () => {
    expect(await requireOnboardingIdentity(request())).toEqual({
      ok: true,
      value: {
        psychologistId: 'owner',
        user: { firebaseUid: 'original-uid', vertical: 'DOCTOR' },
        pendingApproval: true,
      },
    });
    expect(h.exclusive).toHaveBeenCalledWith('original-uid');
  });
  it('preserves the original active-only guard on Mind', async () => {
    const denied = { ok: false, response: NextResponse.json({}, { status: 403 }) };
    h.activeGuard.mockResolvedValue(denied);
    expect(await requireOnboardingIdentity(request('mind.cureocity.in'))).toBe(denied);
    expect(h.identity).not.toHaveBeenCalled();
    expect(h.practitioner).not.toHaveBeenCalled();
  });
  it.each(['SUSPENDED', 'OFFBOARDED'])(
    'rejects %s without exposing the form save',
    async (status) => {
      h.practitioner.mockResolvedValue({ id: 'owner', status, deletedAt: null });
      const auth = await requireOnboardingIdentity(request());
      expect(auth.ok).toBe(false);
      if (!auth.ok) expect(auth.response.status).toBe(403);
    },
  );
  it('rejects deleted accounts', async () => {
    h.practitioner.mockResolvedValue({
      id: 'owner',
      status: 'PENDING_VERIFICATION',
      deletedAt: new Date(),
    });
    expect((await requireOnboardingIdentity(request())).ok).toBe(false);
  });
  it('retains cookie/bearer consistency and CSRF rejection', async () => {
    const denied = { ok: false, response: NextResponse.json({}, { status: 401 }) };
    h.identity.mockResolvedValue(denied);
    expect(await requireOnboardingIdentity(request())).toBe(denied);
    expect(h.practitioner).not.toHaveBeenCalled();
  });
  it('does not cross the patient/practitioner UID boundary', async () => {
    const denied = { ok: false, response: NextResponse.json({}, { status: 403 }) };
    h.exclusive.mockResolvedValue(denied);
    expect(await requireOnboardingIdentity(request())).toBe(denied);
    expect(h.practitioner).not.toHaveBeenCalled();
  });
});
