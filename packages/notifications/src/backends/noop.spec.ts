import { describe, it, expect } from 'vitest';
import { NoopBackend } from './noop';

describe('NoopBackend', () => {
  it('records every call type and returns sent', async () => {
    const noop = new NoopBackend();
    await noop.sendWebPush(
      { endpoint: 'https://push/x', keys: { p256dh: 'p', auth: 'a' } },
      { title: 't', body: 'b' },
    );
    await noop.sendSms({ to: '+919900000000', body: 'hi' });
    await noop.sendWhatsApp({ to: '+919900000000', templateName: 'tpl', templateParams: ['a'] });
    await noop.sendEmail({ to: 'x@y.com', subject: 's', textBody: 'b' });

    expect(noop.calls).toHaveLength(4);
    expect(noop.calls.map((c) => c.type)).toEqual(['web-push', 'sms', 'whatsapp', 'email']);
  });

  it('simulates failure when configured', async () => {
    const noop = new NoopBackend({ simulateOutcome: 'transient_failure' });
    const r = await noop.sendSms({ to: '+919900000000', body: 'hi' });
    expect(r.outcome).toBe('transient_failure');
    expect(r.errorCode).toBe('NOOP_SIMULATED');
  });
});
