import { describe, it, expect, vi } from 'vitest';
import { WatiBackend } from './wati';

const cfg = {
  apiBase: 'https://wati.fake/tenantxyz',
  bearerToken: 'tok',
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

describe('WatiBackend.sendWhatsApp', () => {
  it('posts to sendTemplateMessage with templateName + positional params', async () => {
    const fetchImpl = fetchMock(() => ({ status: 200, json: { result: true, messageId: 'm1' } }));
    const w = new WatiBackend({ ...cfg, fetchImpl: fetchImpl as unknown as typeof fetch });
    const r = await w.sendWhatsApp({
      to: '+919900000000',
      templateName: 'session_reminder',
      templateParams: ['Riya', 'Monday 10am'],
    });
    expect(r.outcome).toBe('sent');
    expect(r.providerMessageId).toBe('wati:m1');
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringMatching(/sendTemplateMessage.*whatsappNumber=%2B919900000000/),
      expect.objectContaining({
        body: expect.stringContaining('session_reminder'),
      }),
    );
  });

  it('threads a media URL when provided', async () => {
    const fetchImpl = fetchMock(() => ({ status: 200, json: { result: true, messageId: 'm2' } }));
    const w = new WatiBackend({ ...cfg, fetchImpl: fetchImpl as unknown as typeof fetch });
    await w.sendWhatsApp({
      to: '+919900000000',
      templateName: 'treatment_plan',
      templateParams: ['Riya'],
      mediaUrl: 'https://s3.example/plans/abc.pdf',
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining('s3.example/plans/abc.pdf'),
      }),
    );
  });

  it('marks 4xx as permanent and 5xx as transient', async () => {
    const fetchImpl4xx = fetchMock(() => ({ status: 400, json: { info: 'bad template' } }));
    const w4 = new WatiBackend({ ...cfg, fetchImpl: fetchImpl4xx as unknown as typeof fetch });
    const r4 = await w4.sendWhatsApp({ to: '+9', templateName: 'x', templateParams: [] });
    expect(r4.outcome).toBe('permanent_failure');
    expect(r4.errorCode).toBe('WATI_400');

    const fetchImpl5xx = fetchMock(() => ({ status: 502, json: { info: 'gateway' } }));
    const w5 = new WatiBackend({ ...cfg, fetchImpl: fetchImpl5xx as unknown as typeof fetch });
    const r5 = await w5.sendWhatsApp({ to: '+9', templateName: 'x', templateParams: [] });
    expect(r5.outcome).toBe('transient_failure');
  });

  it('throws on sendSms (channel must go through Twilio)', async () => {
    const w = new WatiBackend(cfg);
    await expect(w.sendSms({ to: '+919900000000', body: 'x' })).rejects.toThrow(/TwilioBackend/);
  });
});
