import webpush from 'web-push';
import type { IPushNotifier, PushPayload, SendResult, WebPushSubscription } from '../types';

/**
 * WebPushBackend — real Web Push delivery via VAPID. Browser sends
 * subscriptions to us at /api/v1/me/push-subscriptions; this backend
 * pushes payloads to those endpoints.
 *
 * VAPID keys are generated once per environment:
 *   npx web-push generate-vapid-keys
 * and stored as VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY env vars. The
 * public key is also exposed to the browser via
 * NEXT_PUBLIC_VAPID_PUBLIC_KEY for subscription creation.
 *
 * The web-push library transparently encrypts the payload with the
 * subscription's p256dh + auth keys (RFC 8291).
 */
export class WebPushBackend implements IPushNotifier {
  constructor(opts: { vapidPublicKey: string; vapidPrivateKey: string; subjectEmail: string }) {
    webpush.setVapidDetails(
      `mailto:${opts.subjectEmail}`,
      opts.vapidPublicKey,
      opts.vapidPrivateKey,
    );
  }

  async sendWebPush(sub: WebPushSubscription, payload: PushPayload): Promise<SendResult> {
    try {
      const res = await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        JSON.stringify(payload),
        { TTL: 60 * 60 },
      );
      return { outcome: 'sent', providerMessageId: `webpush:${res.statusCode}` };
    } catch (e) {
      const err = e as { statusCode?: number; body?: string; message?: string };
      // 404 / 410: subscription is dead — permanent, evict the row.
      if (err.statusCode === 404 || err.statusCode === 410) {
        return {
          outcome: 'permanent_failure',
          errorCode: `WEBPUSH_${err.statusCode}`,
          errorDetail: err.body ?? err.message ?? 'subscription gone',
        };
      }
      // 4xx other than 404/410: permanent (e.g. invalid VAPID, bad payload size)
      if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
        return {
          outcome: 'permanent_failure',
          errorCode: `WEBPUSH_${err.statusCode}`,
          errorDetail: err.body ?? err.message ?? 'permanent error',
        };
      }
      // 5xx + network errors: transient; caller retries with backoff.
      return {
        outcome: 'transient_failure',
        ...(err.statusCode !== undefined && { errorCode: `WEBPUSH_${err.statusCode}` }),
        errorDetail: err.body ?? err.message ?? 'transient error',
      };
    }
  }
}
