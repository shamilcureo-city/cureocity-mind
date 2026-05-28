/**
 * Notification ports — the surface @cureocity/notifications exposes.
 *
 * Three channel ports:
 *   IPushNotifier    — Web Push (browser PWA) + FCM (Android/iOS PWA install)
 *   IMessagingPort   — SMS (Twilio or Indian alt) and WhatsApp (WATI)
 *   IEmailPort       — transactional email (SendGrid or Indian alt)
 *
 * Each call returns a SendResult describing what happened. The caller
 * (continuity-service / patient-model-service / scribe-service) audits
 * the outcome and decides retry policy; the port itself is one-shot.
 *
 * Reliability strategy:
 *   - All adapters surface transient vs permanent failures via
 *     SendResult.outcome so the caller can backoff vs give up.
 *   - Web Push 410 (Gone) → permanent; caller should evict the
 *     subscription row.
 *   - Twilio / SendGrid / WATI 4xx → permanent; 5xx + network → transient.
 *
 * NoopBackend exists for tests + dev when credentials aren't loaded.
 * Selecting it explicitly is required — there is no implicit fallback
 * in production code paths; missing credentials at startup is a fatal
 * config error.
 */

export type SendOutcome = 'sent' | 'transient_failure' | 'permanent_failure';

export interface SendResult {
  outcome: SendOutcome;
  providerMessageId?: string;
  errorCode?: string;
  errorDetail?: string;
}

// ============================================================================
// Web Push / FCM
// ============================================================================

export interface WebPushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushPayload {
  title: string;
  body: string;
  /** Deep-link the SW opens when the notification is clicked. */
  url?: string;
  /** Coalescing key — newer notifications with the same tag replace older ones. */
  tag?: string;
}

export interface IPushNotifier {
  sendWebPush(sub: WebPushSubscription, payload: PushPayload): Promise<SendResult>;
}

// ============================================================================
// SMS + WhatsApp
// ============================================================================

export interface SmsRequest {
  /** E.164 (+91XXXXXXXXXX for Indian numbers). */
  to: string;
  body: string;
}

export interface WhatsAppRequest {
  to: string;
  /** WATI template name; templates pre-approved by WhatsApp Business. */
  templateName: string;
  /** Positional template parameters; order matches the template. */
  templateParams: string[];
  /** Optional media URL (e.g. a treatment-plan PDF stored in S3). */
  mediaUrl?: string;
}

export interface IMessagingPort {
  sendSms(req: SmsRequest): Promise<SendResult>;
  sendWhatsApp(req: WhatsAppRequest): Promise<SendResult>;
}

// ============================================================================
// Email
// ============================================================================

export interface EmailRequest {
  to: string;
  subject: string;
  textBody: string;
  htmlBody?: string;
  attachments?: { filename: string; contentBase64: string; mimeType: string }[];
}

export interface IEmailPort {
  sendEmail(req: EmailRequest): Promise<SendResult>;
}
