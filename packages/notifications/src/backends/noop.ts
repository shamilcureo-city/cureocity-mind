import type {
  EmailRequest,
  IEmailPort,
  IMessagingPort,
  IPushNotifier,
  PushPayload,
  SendResult,
  SmsRequest,
  WebPushSubscription,
  WhatsAppRequest,
} from '../types';

/**
 * NoopBackend — no outbound traffic. Used in tests + local dev when
 * credentials aren't loaded. Logs every call to a captured list so
 * tests can assert the right requests were attempted without standing
 * up real Twilio / SendGrid / etc.
 *
 * Always returns { outcome: 'sent', providerMessageId: 'noop:<n>' }
 * unless `simulateFailure` is configured.
 */
export class NoopBackend implements IPushNotifier, IMessagingPort, IEmailPort {
  readonly calls: Array<
    | { type: 'web-push'; sub: WebPushSubscription; payload: PushPayload }
    | { type: 'sms'; req: SmsRequest }
    | { type: 'whatsapp'; req: WhatsAppRequest }
    | { type: 'email'; req: EmailRequest }
  > = [];

  private counter = 0;

  constructor(
    private readonly opts: {
      /** If set, all calls return this outcome instead of 'sent'. */
      simulateOutcome?: SendResult['outcome'];
    } = {},
  ) {}

  private result(): SendResult {
    const outcome = this.opts.simulateOutcome ?? 'sent';
    return {
      outcome,
      providerMessageId: `noop:${++this.counter}`,
      ...(outcome !== 'sent' ? { errorCode: 'NOOP_SIMULATED', errorDetail: 'noop' } : {}),
    };
  }

  async sendWebPush(sub: WebPushSubscription, payload: PushPayload): Promise<SendResult> {
    this.calls.push({ type: 'web-push', sub, payload });
    return this.result();
  }

  async sendSms(req: SmsRequest): Promise<SendResult> {
    this.calls.push({ type: 'sms', req });
    return this.result();
  }

  async sendWhatsApp(req: WhatsAppRequest): Promise<SendResult> {
    this.calls.push({ type: 'whatsapp', req });
    return this.result();
  }

  async sendEmail(req: EmailRequest): Promise<SendResult> {
    this.calls.push({ type: 'email', req });
    return this.result();
  }
}
