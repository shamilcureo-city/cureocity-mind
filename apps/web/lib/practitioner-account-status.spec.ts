import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PractitionerAccountStatus } from '../components/app/PractitionerAccountStatus';
import { Sidebar } from '../components/app/Sidebar';

const h = vi.hoisted(() => ({
  host: vi.fn(() => 'scribe.cureocity.in'),
  account: vi.fn(),
  notFound: vi.fn((): never => {
    throw new Error('NOT_FOUND');
  }),
  redirect: vi.fn((path: string): never => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));
vi.mock('./auth-page', () => ({ requirePagePsychologist: h.account }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ host: h.host() }) }));
vi.mock('next/navigation', () => ({
  redirect: h.redirect,
  notFound: h.notFound,
  usePathname: () => '/app/clinic',
}));
import AccountStatusPage from '../app/account-status/page';
import AccountStatusPreview from '../app/dev/scribe-account-status/page';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('React', React);
  h.account.mockResolvedValue({
    status: 'PENDING_VERIFICATION',
    vertical: 'DOCTOR',
    email: 'doctor@example.test',
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('account access explanation', () => {
  it('lets a legacy pending Scribe signup submit registration with Scribe branding', async () => {
    h.account.mockResolvedValue({
      status: 'PENDING_VERIFICATION',
      onboardingCompletedAt: null,
      vertical: 'THERAPIST',
      email: 'doctor@example.test',
    });
    const html = renderToStaticMarkup(await AccountStatusPage());
    expect(html).toContain('Cureocity Scribe');
    expect(html).toContain('Submit registration details');
    expect(html).not.toContain('/app/clinic');
  });
  it('does not introduce the pending-registration exception on Mind', async () => {
    h.host.mockReturnValueOnce('mind.cureocity.in');
    h.account.mockResolvedValue({
      status: 'PENDING_VERIFICATION',
      onboardingCompletedAt: null,
      vertical: 'THERAPIST',
      email: 'therapist@example.test',
    });
    const html = renderToStaticMarkup(await AccountStatusPage());
    expect(html).toContain('Cureocity Mind');
    expect(html).not.toContain('Submit registration details');
  });
  it.each([
    ['PENDING_VERIFICATION', 'Your account is awaiting approval'],
    ['SUSPENDED', 'Your account access is paused'],
    ['OFFBOARDED', 'Your account is closed'],
  ] as const)('explains %s without offering clinical actions or payment', async (status, title) => {
    h.account.mockResolvedValue({ status, vertical: 'DOCTOR', email: 'doctor@example.test' });
    const html = renderToStaticMarkup(await AccountStatusPage());
    expect(html).toContain(title);
    expect(html).toContain('doctor@example.test');
    expect(html).toContain('Cureocity Scribe');
    expect(html).toContain('href="/account-status"');
    expect(html).toContain('Contact support');
    expect(html).toContain('separate from billing');
    expect(html).toContain('method="POST"');
    expect(html).toContain('action="/api/v1/auth/signout"');
    expect(html).not.toContain('Add &amp; start now');
    expect(html).not.toContain('Pending work');
    expect(html).not.toContain('/app/settings/plan');
  });
  it('returns an approved account to the normal app guard', async () => {
    h.account.mockResolvedValue({ status: 'ACTIVE' });
    await expect(AccountStatusPage()).rejects.toThrow('REDIRECT:/app');
  });
  it('preserves sign-in and deletion rejections from the identity guard', async () => {
    h.account.mockRejectedValue(new Error('REDIRECT:/login'));
    await expect(AccountStatusPage()).rejects.toThrow('REDIRECT:/login');
  });
  it('keeps Mind branding and safely escapes the signed-in email', () => {
    const html = renderToStaticMarkup(
      React.createElement(PractitionerAccountStatus, {
        status: 'PENDING_VERIFICATION',
        vertical: 'THERAPIST',
        email: '<script>example</script>@example.test',
      }),
    );
    expect(html).toContain('Cureocity Mind');
    expect(html).not.toContain('Cureocity Scribe');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
  it('labels the doctor sidebar Scribe while preserving Mind', () => {
    const doctor = renderToStaticMarkup(React.createElement(Sidebar, { vertical: 'DOCTOR' }));
    expect(doctor).toContain('aria-label="Cureocity Scribe"');
    expect(doctor).not.toContain('ORBIT');
    const therapist = renderToStaticMarkup(React.createElement(Sidebar, { vertical: 'THERAPIST' }));
    expect(therapist).toContain('Cureocity Mind');
    expect(therapist).not.toContain('Cureocity Scribe');
  });
  it.each([
    ['production', 'true'],
    ['test', 'true'],
    ['development', 'false'],
  ])('does not expose fictional preview in %s with flag %s', (environment, flag) => {
    vi.stubEnv('NODE_ENV', environment);
    vi.stubEnv('SCRIBE_WORKSPACE_PREVIEW', flag);
    expect(() => AccountStatusPreview()).toThrow('NOT_FOUND');
    expect(h.account).not.toHaveBeenCalled();
  });
  it('renders only a fictional account when the local preview is explicitly enabled', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('SCRIBE_WORKSPACE_PREVIEW', 'true');
    const html = renderToStaticMarkup(AccountStatusPreview());
    expect(html).toContain('doctor@example.test');
    expect(h.account).not.toHaveBeenCalled();
  });
});
