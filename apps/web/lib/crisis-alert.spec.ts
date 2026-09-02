import { afterEach, describe, expect, it, vi } from 'vitest';
import { NoopBackend } from '@cureocity/notifications';
import { sendCrisisAlert } from './crisis-alert';

describe('crisis alert backend configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    globalThis.__cureocityCrisisAlertEmail = undefined;
  });

  it('fails closed in production when SendGrid is unconfigured instead of accepting Noop SENT', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('SENDGRID_API_KEY', '');
    vi.stubEnv('SENDGRID_FROM_EMAIL', '');
    globalThis.__cureocityCrisisAlertEmail = undefined;

    await expect(
      sendCrisisAlert({
        to: 'therapist@example.test',
        therapistName: 'Therapist',
        clientRecordUrl: 'https://mind.example/app/clients/client-1',
        idempotencyKey: 'alert-1',
      }),
    ).resolves.toEqual({
      outcome: 'permanent_failure',
      errorCode: 'CRISIS_EMAIL_NOT_CONFIGURED',
    });
  });

  it('never accepts a cached or injected Noop SENT outcome in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SENDGRID_API_KEY', 'configured-key');
    vi.stubEnv('SENDGRID_FROM_EMAIL', 'alerts@example.test');
    globalThis.__cureocityCrisisAlertEmail = new NoopBackend();

    await expect(
      sendCrisisAlert({
        to: 'therapist@example.test',
        therapistName: 'Therapist',
        clientRecordUrl: 'https://mind.example/app/clients/client-1',
        idempotencyKey: 'alert-2',
      }),
    ).resolves.toEqual({
      outcome: 'permanent_failure',
      errorCode: 'CRISIS_EMAIL_BACKEND_UNAVAILABLE',
    });
  });
});
