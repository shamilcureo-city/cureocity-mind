import type { IMessagingPort, SendResult, SmsRequest, WhatsAppRequest } from '../types';

/**
 * TwilioBackend — REST adapter for Twilio Programmable SMS.
 *
 * Avoids the `twilio` SDK dep (which pulls in a hefty graph). The
 * Twilio Messages API is a single POST to
 *   https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json
 * with Basic auth using {accountSid}:{authToken}. This is the same
 * format the SDK uses; we just skip the wrapper.
 *
 * WhatsApp is NOT routed via Twilio in our stack — we use WATI for
 * India-resident WhatsApp Business templates. sendWhatsApp here
 * throws so misconfiguration surfaces loudly instead of silently
 * using the wrong channel.
 */
export class TwilioBackend implements IMessagingPort {
  constructor(
    private readonly opts: {
      accountSid: string;
      authToken: string;
      /** Twilio sender phone in E.164 or messaging service SID. */
      fromNumber: string;
      /** Override the API base for tests. */
      apiBase?: string;
      /** Override fetch for tests. */
      fetchImpl?: typeof fetch;
    },
  ) {}

  async sendSms(req: SmsRequest): Promise<SendResult> {
    const apiBase = this.opts.apiBase ?? 'https://api.twilio.com';
    const url = `${apiBase}/2010-04-01/Accounts/${encodeURIComponent(this.opts.accountSid)}/Messages.json`;
    const body = new URLSearchParams({ From: this.opts.fromNumber, To: req.to, Body: req.body });
    const auth = Buffer.from(`${this.opts.accountSid}:${this.opts.authToken}`).toString('base64');
    const fetchFn = this.opts.fetchImpl ?? fetch;
    try {
      const res = await fetchFn(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: body.toString(),
      });
      const json = (await res.json().catch(() => ({}))) as {
        sid?: string;
        message?: string;
        code?: number;
      };
      if (res.ok && json.sid) {
        return { outcome: 'sent', providerMessageId: `twilio:${json.sid}` };
      }
      // Twilio: 4xx with error code is permanent; 5xx transient.
      if (res.status >= 400 && res.status < 500) {
        return {
          outcome: 'permanent_failure',
          errorCode: `TWILIO_${json.code ?? res.status}`,
          errorDetail: json.message ?? `HTTP ${res.status}`,
        };
      }
      return {
        outcome: 'transient_failure',
        errorCode: `TWILIO_${res.status}`,
        errorDetail: json.message ?? `HTTP ${res.status}`,
      };
    } catch (e) {
      // Network / DNS / abort → transient
      return {
        outcome: 'transient_failure',
        errorCode: 'TWILIO_NETWORK',
        errorDetail: (e as Error).message,
      };
    }
  }

  async sendWhatsApp(_req: WhatsAppRequest): Promise<SendResult> {
    throw new Error(
      'TwilioBackend.sendWhatsApp is not supported — route WhatsApp through WatiBackend instead.',
    );
  }
}
