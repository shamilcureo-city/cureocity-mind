import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  cookie: vi.fn(),
  verify: vi.fn(),
  practitioner: vi.fn(),
  patients: vi.fn(),
  queue: vi.fn(),
  decrypt: vi.fn(),
  entitlement: vi.fn(),
  redirect: vi.fn((path: string): never => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  cache: (fn: unknown) => fn,
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: h.cookie }),
  headers: async () => new Headers({ host: 'scribe.cureocity.in' }),
}));
vi.mock('next/navigation', () => ({ redirect: h.redirect }));
vi.mock('./firebase-admin', () => ({ firebaseAuth: () => ({ verifySessionCookie: h.verify }) }));
vi.mock('./auth-server', () => ({
  SESSION_COOKIE_NAME: '__session',
  bypassFirebaseUid: () => 'fixture-uid',
  isAuthBypassed: () => false,
  verifyWithRetry: (fn: () => Promise<unknown>) => fn(),
  sessionCookieDomain: () => undefined,
}));
vi.mock('./prisma', () => ({
  prisma: {
    psychologist: { findUnique: h.practitioner },
    client: { findMany: h.patients },
  },
}));
vi.mock('./clinic-queue', () => ({ loadClinicQueue: h.queue }));
vi.mock('./client-pii', () => ({ decryptClientField: h.decrypt }));
vi.mock('./billing', () => ({ getEntitlement: h.entitlement }));

import {
  requirePagePsychologist,
  requireActivePagePsychologist,
  requireOnboardedPsychologist,
  requireOnboardedDoctor,
  requireOnboardedTherapist,
  requirePageAdmin,
} from './auth-page';
import ClinicPage from '../app/app/clinic/page';
import AppLayout from '../app/app/layout';
import OnboardingPage from '../app/onboarding/page';

const account = {
  id: 'fixture-doctor',
  firebaseUid: 'fixture-uid',
  email: 'doctor@example.test',
  status: 'ACTIVE',
  deletedAt: null,
  vertical: 'DOCTOR',
  role: 'THERAPIST',
  onboardingCompletedAt: new Date('2026-01-01T00:00:00Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('React', React);
  h.cookie.mockReturnValue({ value: 'fictional-cookie' });
  h.verify.mockResolvedValue({ uid: 'fixture-uid' });
  h.practitioner.mockResolvedValue({ ...account });
});
afterEach(() => vi.unstubAllGlobals());

describe('practitioner page lifecycle boundary', () => {
  it.each(['auth/session-cookie-revoked', 'auth/user-disabled'])(
    'rejects %s before reading the practitioner record',
    async (code) => {
      h.verify.mockImplementation(async (_cookie, checkRevoked) => {
        if (checkRevoked) throw { code };
        return { uid: 'fixture-uid' };
      });
      await expect(requireOnboardedTherapist()).rejects.toThrow('REDIRECT:/login');
      expect(h.verify).toHaveBeenCalledWith('fictional-cookie', true);
      expect(h.practitioner).not.toHaveBeenCalled();
    },
  );
  it.each(['PENDING_VERIFICATION', 'SUSPENDED', 'OFFBOARDED'])(
    'blocks %s at every clinical guard before onboarding or role checks',
    async (status) => {
      h.practitioner.mockResolvedValue({
        ...account,
        status,
        onboardingCompletedAt: null,
        role: 'ADMIN',
      });
      for (const guard of [
        requireActivePagePsychologist,
        requireOnboardedPsychologist,
        requireOnboardedDoctor,
        requireOnboardedTherapist,
        requirePageAdmin,
      ]) {
        await expect(guard()).rejects.toThrow('REDIRECT:/account-status');
      }
      expect(h.redirect).not.toHaveBeenCalledWith('/onboarding');
    },
  );
  it.each(['PENDING_VERIFICATION', 'SUSPENDED', 'OFFBOARDED'])(
    'does not load clinic data or billing, or offer onboarding for %s',
    async (status) => {
      h.practitioner.mockResolvedValue({ ...account, status });
      await expect(ClinicPage()).rejects.toThrow('REDIRECT:/account-status');
      await expect(
        AppLayout({ children: React.createElement('p', null, 'clinical child') }),
      ).rejects.toThrow('REDIRECT:/account-status');
      await expect(OnboardingPage()).rejects.toThrow('REDIRECT:/account-status');
      expect(h.queue).not.toHaveBeenCalled();
      expect(h.patients).not.toHaveBeenCalled();
      expect(h.decrypt).not.toHaveBeenCalled();
      expect(h.entitlement).not.toHaveBeenCalled();
    },
  );
  it('keeps an identity-only path for the status page without granting clinical access', async () => {
    h.practitioner.mockResolvedValue({ ...account, status: 'PENDING_VERIFICATION' });
    expect((await requirePagePsychologist()).status).toBe('PENDING_VERIFICATION');
    expect(h.redirect).not.toHaveBeenCalled();
  });
  it.each(['DOCTOR', 'THERAPIST'] as const)(
    'allows active onboarded %s accounts',
    async (vertical) => {
      h.practitioner.mockResolvedValue({ ...account, vertical });
      const guard = vertical === 'DOCTOR' ? requireOnboardedDoctor : requireOnboardedTherapist;
      expect((await guard()).id).toBe(account.id);
      expect(h.redirect).not.toHaveBeenCalled();
    },
  );
  it('still directs an active incomplete account to onboarding', async () => {
    h.practitioner.mockResolvedValue({ ...account, onboardingCompletedAt: null });
    await expect(requireOnboardedDoctor()).rejects.toThrow('REDIRECT:/onboarding');
  });
  it('still enforces doctor and therapist separation', async () => {
    await expect(requireOnboardedTherapist()).rejects.toThrow('REDIRECT:/app');
    h.practitioner.mockResolvedValue({ ...account, vertical: 'THERAPIST' });
    await expect(requireOnboardedDoctor()).rejects.toThrow('REDIRECT:/app');
  });
  it('still requires an administrator for console pages', async () => {
    await expect(requirePageAdmin()).rejects.toThrow('REDIRECT:/app');
    h.practitioner.mockResolvedValue({ ...account, role: 'ADMIN' });
    expect((await requirePageAdmin()).id).toBe(account.id);
  });
  it('sends a signed-out visitor to login without reading the database', async () => {
    h.cookie.mockReturnValue(undefined);
    await expect(requireActivePagePsychologist()).rejects.toThrow('REDIRECT:/login');
    expect(h.practitioner).not.toHaveBeenCalled();
  });
  it('does not expose even the status page for a deleted account', async () => {
    h.practitioner.mockResolvedValue({ ...account, deletedAt: new Date() });
    await expect(requirePagePsychologist()).rejects.toThrow('REDIRECT:/login');
  });
  it('recognizes administrator activation on the next request', async () => {
    h.practitioner.mockResolvedValueOnce({ ...account, status: 'PENDING_VERIFICATION' });
    await expect(requireOnboardedDoctor()).rejects.toThrow('REDIRECT:/account-status');
    expect((await requireOnboardedDoctor()).id).toBe(account.id);
  });
});
