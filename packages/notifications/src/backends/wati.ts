import type { IMessagingPort, SendResult, SmsRequest, WhatsAppRequest } from '../types';

/**
 * WatiBackend — WhatsApp Business via WATI (Mumbai-resident
 * BSP). REST API, Bearer-token auth, template-based.
 *
 * Two send modes per WATI's docs:
 *   POST /api/v1/sendTemplateMessage     — by template name with params
 *   POST /api/v1/sendSessionFile         — for media we host (treatment plan PDFs)
 *
 * For V1 we only use sendTemplateMessage; treatment-plan delivery uses
 * a template with a single document parameter pointing at the
 * therapist-issued PDF URL.
 *
 * SMS goes through Twilio, not WATI — sendSms here throws so a
 * misconfigured caller fails loudly.
 */
export class WatiBackend implements IMessagingPort {
  constructor(
    private readonly opts: {
      /** WATI API endpoint, e.g. https://live-mt-server.wati.io/<tenant-id>. */
      apiBase: string;
      bearerToken: string;
      fetchImpl?: typeof fetch;
    },
  ) {}

  async sendSms(_req: SmsRequest): Promise<SendResult> {
    throw new Error('WatiBackend.sendSms is not supported — route SMS through TwilioBackend.');
  }

  async sendWhatsApp(req: WhatsAppRequest): Promise<SendResult> {
    const fetchFn = this.opts.fetchImpl ?? fetch;
    const url = `${this.opts.apiBase.replace(/\/$/, '')}/api/v1/sendTemplateMessage?whatsappNumber=${encodeURIComponent(req.to)}`;
    const body = {
      template_name: req.templateName,
      broadcast_name: req.templateName,
      parameters: req.templateParams.map((value, i) => ({ name: `${i + 1}`, value })),
      ...(req.mediaUrl !== undefined && { media: { url: req.mediaUrl } }),
    };
    try {
      const res = await fetchFn(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.opts.bearerToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as {
        result?: boolean;
        info?: string;
        messageId?: string;
      };
      if (res.ok && json.result !== false) {
        return {
          outcome: 'sent',
          providerMessageId: `wati:${json.messageId ?? 'unknown'}`,
        };
      }
      if (res.status >= 400 && res.status < 500) {
        return {
          outcome: 'permanent_failure',
          errorCode: `WATI_${res.status}`,
          errorDetail: json.info ?? `HTTP ${res.status}`,
        };
      }
      return {
        outcome: 'transient_failure',
        errorCode: `WATI_${res.status}`,
        errorDetail: json.info ?? `HTTP ${res.status}`,
      };
    } catch (e) {
      return {
        outcome: 'transient_failure',
        errorCode: 'WATI_NETWORK',
        errorDetail: (e as Error).message,
      };
    }
  }
}
