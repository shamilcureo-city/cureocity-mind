import { describe, it, expect, vi } from 'vitest';
import { SendGridBackend } from './sendgrid';

const cfg = {
  apiKey: 'SG.xxxx',
  fromEmail: 'noreply@cureocity.in',
  fromName: 'Cureocity Mind',
  apiBase: 'https://sendgrid.fake',
};

function fetchMock(
  handler: (
    url: string,
    init: RequestInit,
  ) => {
    status: number;
    text: string;
    headers?: Record<string, string>;
  },
) {
  return vi.fn(async (url: string, init: RequestInit) => {
    const { status, text, headers } = handler(url, init);
    const hdrs = new Map(Object.entries(headers ?? {}));
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (k: string) => hdrs.get(k.toLowerCase()) ?? null },
      text: async () => text,
    } as unknown as Response;
  });
}

describe('SendGridBackend.sendEmail', () => {
  it('returns sent + provider id from x-message-id on 202', async () => {
    const fetchImpl = fetchMock(() => ({
      status: 202,
      text: '',
      headers: { 'x-message-id': 'sg-abc-123' },
    }));
    const s = new SendGridBackend({ ...cfg, fetchImpl: fetchImpl as unknown as typeof fetch });
    const r = await s.sendEmail({ to: 'x@y.com', subject: 'hi', textBody: 'hello' });
    expect(r.outcome).toBe('sent');
    expect(r.providerMessageId).toBe('sendgrid:sg-abc-123');
  });

  it('does not inspect a response body or retry after SendGrid accepts the message', async () => {
    const text = vi.fn().mockRejectedValue(new Error('response stream reset after acceptance'));
    const fetchImpl = vi.fn(async () => ({
      status: 202,
      headers: { get: () => 'sg-accepted' },
      text,
    })) as unknown as typeof fetch;
    const s = new SendGridBackend({ ...cfg, fetchImpl });

    await expect(s.sendEmail({ to: 'x@y.com', subject: 'hi', textBody: 'hello' })).resolves.toEqual(
      {
        outcome: 'sent',
        providerMessageId: 'sendgrid:sg-accepted',
      },
    );
    expect(text).not.toHaveBeenCalled();
  });

  it('marks 4xx as permanent', async () => {
    const fetchImpl = fetchMock(() => ({ status: 400, text: '{"errors":[{"message":"bad to"}]}' }));
    const s = new SendGridBackend({ ...cfg, fetchImpl: fetchImpl as unknown as typeof fetch });
    const r = await s.sendEmail({ to: 'bad', subject: 'x', textBody: 'y' });
    expect(r.outcome).toBe('permanent_failure');
    expect(r.errorCode).toBe('SENDGRID_400');
  });

  it('threads attachments', async () => {
    const fetchImpl = fetchMock(() => ({
      status: 202,
      text: '',
      headers: { 'x-message-id': 'sg-2' },
    }));
    const s = new SendGridBackend({ ...cfg, fetchImpl: fetchImpl as unknown as typeof fetch });
    await s.sendEmail({
      to: 'x@y.com',
      subject: 's',
      textBody: 't',
      attachments: [
        { filename: 'plan.pdf', contentBase64: 'aGVsbG8=', mimeType: 'application/pdf' },
      ],
    });
    const call = fetchImpl.mock.calls[0]!;
    expect(call[1]!.body).toContain('"filename":"plan.pdf"');
    expect(call[1]!.body).toContain('"content":"aGVsbG8="');
  });

  it('passes a caller idempotency key to providers that support it', async () => {
    const fetchImpl = fetchMock(() => ({ status: 202, text: '' }));
    const s = new SendGridBackend({ ...cfg, fetchImpl: fetchImpl as unknown as typeof fetch });

    await s.sendEmail({
      to: 'x@y.com',
      subject: 's',
      textBody: 'b',
      idempotencyKey: 'appointment-reminder:appt-1:2H:therapist',
    });

    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toMatchObject({
      'Idempotency-Key': 'appointment-reminder:appt-1:2H:therapist',
    });
  });

  it('marks network errors as transient', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('socket hang up');
    });
    const s = new SendGridBackend({ ...cfg, fetchImpl: fetchImpl as unknown as typeof fetch });
    const r = await s.sendEmail({ to: 'x@y.com', subject: 's', textBody: 'b' });
    expect(r.outcome).toBe('transient_failure');
    expect(r.errorCode).toBe('SENDGRID_NETWORK');
  });
});
