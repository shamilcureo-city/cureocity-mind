'use client';

import type { User } from 'firebase/auth';
import { ContinuityApi } from './continuity-api';

const SW_PATH = '/sw.js';
const VAPID_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';

/**
 * Registers the service worker (if not already) and requests / subscribes
 * to Web Push, then POSTs the subscription to continuity-service so
 * adherence reminders can fan out.
 *
 * Idempotent — the SW skipWaiting + clients.claim path means existing
 * subscriptions are upserted server-side, so calling this on every
 * home-page mount is safe. Returns the outcome so the page can show
 * a confirmation toast or fall through silently.
 *
 * Browsers without service workers or PushManager (older Safari) skip
 * to 'unsupported' without throwing.
 */

export type PushRegistrationOutcome =
  | { status: 'subscribed' }
  | { status: 'permission-denied' }
  | { status: 'unsupported' }
  | { status: 'error'; message: string };

export async function ensurePushSubscription(user: User): Promise<PushRegistrationOutcome> {
  if (typeof window === 'undefined') return { status: 'unsupported' };
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { status: 'unsupported' };
  }
  if (!VAPID_KEY) {
    // No VAPID configured — silently skip rather than erroring; the
    // server still works for the rest of the patient PWA.
    return { status: 'unsupported' };
  }
  if (Notification.permission === 'denied') {
    return { status: 'permission-denied' };
  }

  try {
    let registration = await navigator.serviceWorker.getRegistration(SW_PATH);
    if (!registration) {
      registration = await navigator.serviceWorker.register(SW_PATH);
    }
    await navigator.serviceWorker.ready;

    if (Notification.permission === 'default') {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        return perm === 'denied'
          ? { status: 'permission-denied' }
          : { status: 'error', message: 'permission not granted' };
      }
    }

    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_KEY),
      }));

    const json = subscription.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
      return { status: 'error', message: 'subscription missing endpoint or keys' };
    }

    const idToken = await user.getIdToken();
    await fetch(`${continuityBase()}/me/push-subscriptions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
        userAgent: navigator.userAgent,
      }),
    });

    return { status: 'subscribed' };
  } catch (e) {
    return { status: 'error', message: (e as Error).message };
  }
}

function continuityBase(): string {
  return process.env.NEXT_PUBLIC_API_BASE ?? '/api/v1';
}

function urlBase64ToUint8Array(b64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (b64.length % 4)) % 4);
  const base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const buf = new ArrayBuffer(raw.length);
  const arr = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

// Re-export for symmetry — the home page calls ContinuityApi.nextSession etc.
// via the typed wrapper; push subscription registration goes through the
// raw fetch above because the subscription endpoint isn't typed against
// the standard pattern (no return-value reuse).
void ContinuityApi;
