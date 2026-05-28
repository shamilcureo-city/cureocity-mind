import { describe, it, expect, vi } from 'vitest';
import { TwilioBackend } from './twilio';

const cfg = {
  accountSid: 'AC' + 'a'.repeat(32),
  authToken: 'token',
  fromNumber: '+15551234567',
  apiBase: 'https://twilio.fake',
};

function fetchMock(handler: (url: string, init: RequestInit) => { status: number; json: unknown }) {
  return vi.fn(async (url: string, init: RequestInit) => {
    const { status, json } = handler(url, init);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => json,
    } as unknown as Response;
  });
}

describe('TwilioBackend', () => {
  it('returns sent + provider id on 2xx + sid', async () => {
    const fetchImpl = fetchMock(() => ({ status: 201, json: { sid: 'SM123' } }));
    const t = new TwilioBackend({ ...cfg, fetchImpl: fetchImpl as unknown as typeof fetch });
    const r = await t.sendSms({ to: '+919900000000', body: 'hi' });
    expect(r.outcome).toBe('sent');
    expect(r.providerMessageId).toBe('twilio:SM123');
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining(`Accounts/${cfg.accountSid}/Messages.json`),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('marks 4xx with twilio error code as permanent', async () => {
    const fetchImpl = fetchMock(() => ({
      status: 400,
      json: { code: 21211, message: 'Invalid To Number' },
    }));
    const t = new TwilioBackend({ ...cfg, fetchImpl: fetchImpl as unknown as typeof fetch });
    const r = await t.sendSms({ to: 'bad', body: 'x' });
    expect(r.outcome).toBe('permanent_failure');
    expect(r.errorCode).toBe('TWILIO_21211');
  });

  it('marks 5xx as transient', async () => {
    const fetchImpl = fetchMock(() => ({ status: 503, json: { message: 'svc unavailable' } }));
    const t = new TwilioBackend({ ...cfg, fetchImpl: fetchImpl as unknown as typeof fetch });
    const r = await t.sendSms({ to: '+919900000000', body: 'x' });
    expect(r.outcome).toBe('transient_failure');
    expect(r.errorCode).toBe('TWILIO_503');
  });

  it('marks network errors as transient', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const t = new TwilioBackend({ ...cfg, fetchImpl: fetchImpl as unknown as typeof fetch });
    const r = await t.sendSms({ to: '+919900000000', body: 'x' });
    expect(r.outcome).toBe('transient_failure');
    expect(r.errorCode).toBe('TWILIO_NETWORK');
  });

  it('throws on sendWhatsApp (channel must go through WATI)', async () => {
    const t = new TwilioBackend(cfg);
    await expect(
      t.sendWhatsApp({ to: '+919900000000', templateName: 'tpl', templateParams: [] }),
    ).rejects.toThrow(/WatiBackend/);
  });
});
