import type { EmailRequest, IEmailPort, SendResult } from '../types';

/**
 * SendGridBackend — SendGrid v3 Mail Send.
 *
 * POST https://api.sendgrid.com/v3/mail/send with Bearer auth. We
 * always send a single-recipient personalisation per request so the
 * audit row corresponds one-to-one with a send attempt.
 *
 * Indian-resident alternative (e.g. MSG91 Email) shares the same
 * IEmailPort and is wired in by selecting a different backend at
 * service bootstrap — no caller change needed.
 */
export class SendGridBackend implements IEmailPort {
  constructor(
    private readonly opts: {
      apiKey: string;
      fromEmail: string;
      fromName: string;
      apiBase?: string;
      fetchImpl?: typeof fetch;
    },
  ) {}

  async sendEmail(req: EmailRequest): Promise<SendResult> {
    const apiBase = this.opts.apiBase ?? 'https://api.sendgrid.com';
    const url = `${apiBase}/v3/mail/send`;
    const body = {
      personalizations: [{ to: [{ email: req.to }] }],
      from: { email: this.opts.fromEmail, name: this.opts.fromName },
      subject: req.subject,
      content: [
        { type: 'text/plain', value: req.textBody },
        ...(req.htmlBody !== undefined ? [{ type: 'text/html', value: req.htmlBody }] : []),
      ],
      ...(req.attachments &&
        req.attachments.length > 0 && {
          attachments: req.attachments.map((a) => ({
            content: a.contentBase64,
            filename: a.filename,
            type: a.mimeType,
            disposition: 'attachment',
          })),
        }),
    };
    const fetchFn = this.opts.fetchImpl ?? fetch;
    try {
      const res = await fetchFn(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.opts.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      // SendGrid: 202 Accepted means queued. Message id lives in
      // X-Message-Id header.
      if (res.status === 202) {
        const id = res.headers.get('x-message-id') ?? 'unknown';
        return { outcome: 'sent', providerMessageId: `sendgrid:${id}` };
      }
      const text = await res.text().catch(() => '');
      if (res.status >= 400 && res.status < 500) {
        return {
          outcome: 'permanent_failure',
          errorCode: `SENDGRID_${res.status}`,
          errorDetail: text || `HTTP ${res.status}`,
        };
      }
      return {
        outcome: 'transient_failure',
        errorCode: `SENDGRID_${res.status}`,
        errorDetail: text || `HTTP ${res.status}`,
      };
    } catch (e) {
      return {
        outcome: 'transient_failure',
        errorCode: 'SENDGRID_NETWORK',
        errorDetail: (e as Error).message,
      };
    }
  }
}
