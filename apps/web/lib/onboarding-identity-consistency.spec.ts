import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  account: vi.fn(),
  bypassed: vi.fn(),
  host: vi.fn(),
  provider: vi.fn(),
  redirect: vi.fn((path: string): never => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

vi.mock('./auth-page', () => ({ requireActivePagePsychologist: mocks.account }));
vi.mock('./auth-server', () => ({ isAuthBypassed: mocks.bypassed }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ host: mocks.host() }) }));
vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('../components/app/AuthedFetchProvider', () => ({
  AuthedFetchProvider: (props: { expectedUid: string | null; children: React.ReactNode }) => {
    mocks.provider(props.expectedUid);
    return React.createElement('div', { 'data-identity-bound': true }, props.children);
  },
}));

import OnboardingPage from '../app/onboarding/page';

const account = {
  id: 'fictional-practitioner',
  firebaseUid: 'page-account-uid',
  phone: 'pending:page-account-uid',
  fullName: 'Fictional practitioner',
  email: 'fictional@example.test',
  onboardingCompletedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('React', React);
  mocks.account.mockResolvedValue(account);
  mocks.bypassed.mockReturnValue(false);
  mocks.host.mockReturnValue('scribe.cureocity.in');
});
afterEach(() => vi.unstubAllGlobals());

describe('onboarding account consistency', () => {
  it.each([
    ['scribe.cureocity.in', 'Medical registration number', 'Specialty'],
    ['mind.cureocity.in', 'RCI registration number', 'RCI registration number'],
  ])(
    'binds %s onboarding to the server page identity and preserves its fields',
    async (host, registration, specialty) => {
      mocks.host.mockReturnValue(host);
      const html = renderToStaticMarkup(await OnboardingPage());
      expect(mocks.provider).toHaveBeenCalledExactlyOnceWith(account.firebaseUid);
      expect(html).toContain('data-identity-bound="true"');
      expect(html).toContain('<form');
      expect(html).toContain(registration);
      expect(html).toContain(specialty);
      expect(html).toContain(account.fullName);
      expect(html).toContain(account.email);
      expect(html).toContain('Practitioner type');
    },
  );

  it('passes no live identity expectation in explicit local auth-bypass mode', async () => {
    mocks.bypassed.mockReturnValue(true);
    renderToStaticMarkup(await OnboardingPage());
    expect(mocks.provider).toHaveBeenCalledExactlyOnceWith(null);
  });

  it('preserves the completed-account redirect without rendering onboarding', async () => {
    mocks.account.mockResolvedValue({ ...account, onboardingCompletedAt: new Date() });
    await expect(OnboardingPage()).rejects.toThrow('REDIRECT:/app');
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it('preserves the active-account guard instead of opening a form for denied accounts', async () => {
    mocks.account.mockRejectedValue(new Error('REDIRECT:/account-status'));
    await expect(OnboardingPage()).rejects.toThrow('REDIRECT:/account-status');
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it('submits only through the identity-bound transport, without a cookie remint or token fallback', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'components/app/OnboardingForm.tsx'),
      'utf8',
    );
    expect(source.match(/\bfetch\(/g)).toHaveLength(1);
    expect(source).toContain("fetch('/api/v1/onboarding/complete'");
    expect(source).not.toContain('/api/v1/auth/session');
    expect(source).not.toContain('getFirebaseAuth');
    expect(source).not.toContain('getIdToken');
    expect(source).not.toContain('Authorization');
    expect(source).toContain("vertical === 'DOCTOR'");
    expect(source).toContain('medicalRegNumber: medicalRegNumber.trim()');
    expect(source).toContain('rciNumber: rciNumber.trim()');
    expect(source).toContain(
      "router.replace(vertical === 'DOCTOR' ? '/app/clinic' : '/app/today')",
    );
  });
});
