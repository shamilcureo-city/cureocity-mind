import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('@cureocity/notifications', () => ({
  NoopBackend: class {
    sendEmail = h.send;
  },
  SendGridBackend: class {
    sendEmail = h.send;
  },
}));
import { sendWelcomeEmail } from './welcome-email';
beforeEach(() => {
  vi.clearAllMocks();
  h.send.mockResolvedValue({ outcome: 'sent' });
  globalThis.__cureocityWelcomeEmail = undefined;
  globalThis.__cureocityScribeWelcomeEmail = undefined;
});
afterEach(() => vi.unstubAllEnvs());
describe('product registration acknowledgement', () => {
  it('acknowledges Scribe without claiming approval or using Mind welcome overrides', async () => {
    vi.stubEnv('WELCOME_EMAIL_SUBJECT', 'Mind custom subject');
    await sendWelcomeEmail({
      to: 'doctor@example.test',
      fullName: '<Fictional doctor>',
      vertical: 'DOCTOR',
    });
    expect(h.send.mock.calls[0]?.[0]).toMatchObject({
      subject: 'Registration received | Cureocity Scribe',
    });
    expect(h.send.mock.calls[0]?.[0].textBody).toContain('Submission does not approve');
    expect(h.send.mock.calls[0]?.[0].htmlBody).toContain('&lt;Fictional doctor&gt;');
    expect(h.send.mock.calls[0]?.[0].textBody).not.toContain('Cureocity Mind');
  });
  it('preserves the current Mind subject override', async () => {
    vi.stubEnv('WELCOME_EMAIL_SUBJECT', 'Mind custom subject');
    await sendWelcomeEmail({ to: 'therapist@example.test', fullName: 'Fictional therapist' });
    expect(h.send.mock.calls[0]?.[0]).toMatchObject({ subject: 'Mind custom subject' });
    expect(h.send.mock.calls[0]?.[0].textBody).toContain('Cureocity Mind');
  });
});
