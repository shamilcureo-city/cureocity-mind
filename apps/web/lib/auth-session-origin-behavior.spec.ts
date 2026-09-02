import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  parseJson: vi.fn(),
  verifyIdToken: vi.fn(),
  createSessionCookie: vi.fn(),
  psychologistFindUnique: vi.fn(),
}));

vi.mock('./auth-server', () => ({
  SESSION_COOKIE_MAX_AGE_MS: 3_600_000,
  SESSION_COOKIE_NAME: '__session',
  assertUidAvailableForPractitioner: vi.fn(async () => ({ ok: true })),
  isAuthBypassed: vi.fn(() => false),
  sessionCookieDomain: vi.fn(() => undefined),
}));
vi.mock('./audit', () => ({ writeAudit: vi.fn() }));
vi.mock('./clinic', () => ({ ensurePersonalClinic: vi.fn() }));
vi.mock('./firebase-admin', () => ({
  firebaseAuth: vi.fn(() => ({
    verifyIdToken: mocks.verifyIdToken,
    createSessionCookie: mocks.createSessionCookie,
  })),
}));
vi.mock('./invite', () => ({
  isPilotInviteRequired: vi.fn(() => false),
  redeemInviteCode: vi.fn(),
}));
vi.mock('./referral', () => ({ redeemReferralAtSignup: vi.fn() }));
vi.mock('./validate', () => ({ parseJson: mocks.parseJson }));
vi.mock('./prisma', () => ({
  prisma: {
    psychologist: { findUnique: mocks.psychologistFindUnique },
  },
}));

import { POST } from '../app/api/v1/auth/session/route';

function loginRequest(headers: HeadersInit = {}): Request {
  return new Request('https://mind.cureocity.in/api/v1/auth/session', {
    method: 'POST',
    headers,
    body: JSON.stringify({ idToken: 'attacker-controlled-token' }),
  });
}

describe('session creation login-CSRF boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.parseJson.mockResolvedValue({ ok: true, value: { idToken: 'first-party-token' } });
    mocks.verifyIdToken.mockResolvedValue({ uid: 'uid-1' });
    mocks.createSessionCookie.mockResolvedValue('session-cookie');
    mocks.psychologistFindUnique.mockResolvedValue({ id: 'psy-1', deletedAt: null });
  });

  it.each([
    [
      'cross-origin',
      {
        origin: 'https://evil.example',
        'sec-fetch-site': 'cross-site',
        'content-type': 'application/json',
      },
    ],
    [
      'sibling-origin',
      {
        origin: 'https://admin.cureocity.in',
        'sec-fetch-site': 'same-site',
        'content-type': 'application/json',
      },
    ],
    [
      'text/plain',
      {
        origin: 'https://mind.cureocity.in',
        'sec-fetch-site': 'same-origin',
        'content-type': 'text/plain',
      },
    ],
    ['missing Origin', { 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }],
    [
      'missing Fetch Metadata',
      { origin: 'https://mind.cureocity.in', 'content-type': 'application/json' },
    ],
  ])('rejects %s before parsing or verifying an attacker token', async (_case, headers) => {
    const response = await POST(loginRequest(headers) as never);

    expect(response.status).toBe(403);
    expect(mocks.parseJson).not.toHaveBeenCalled();
    expect(mocks.verifyIdToken).not.toHaveBeenCalled();
    expect(mocks.createSessionCookie).not.toHaveBeenCalled();
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('creates a session for an affirmative same-origin first-party JSON login', async () => {
    const response = await POST(
      loginRequest({
        origin: 'https://mind.cureocity.in',
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json; charset=utf-8',
      }) as never,
    );

    expect(response.status).toBe(200);
    expect(mocks.parseJson).toHaveBeenCalledOnce();
    expect(mocks.verifyIdToken).toHaveBeenCalledWith('first-party-token');
    expect(mocks.createSessionCookie).toHaveBeenCalledWith('first-party-token', {
      expiresIn: 3_600_000,
    });
    expect(response.headers.get('set-cookie')).toContain('__session=session-cookie');
  });
});
