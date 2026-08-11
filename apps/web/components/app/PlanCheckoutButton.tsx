'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { planLabel } from '@cureocity/contracts';
import type { CreateCheckoutResponse, PurchasablePlan } from '@cureocity/contracts';

interface Props {
  plan: PurchasablePlan;
  label?: string;
  variant?: 'primary' | 'secondary';
}

/**
 * Sprint 53 — Razorpay Checkout launcher.
 *
 * Calls POST /api/v1/billing/checkout to mint an order, then injects
 * https://checkout.razorpay.com/v1/checkout.js (once) and opens the
 * widget with `{ key, order_id }`. On the success callback we poll
 * GET /billing/me — the webhook is the source of truth for "did it
 * succeed?". Tampered or unverified callback signatures never flip
 * the plan; only the webhook does.
 */
declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

interface RazorpayOptions {
  key: string;
  amount: number;
  currency: 'INR';
  name: string;
  description?: string;
  order_id: string;
  handler?: (response: { razorpay_payment_id: string }) => void;
  modal?: { ondismiss?: () => void };
}
interface RazorpayInstance {
  open(): void;
  on(event: string, cb: (resp: unknown) => void): void;
}

const CHECKOUT_SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js';

async function ensureRazorpay(): Promise<NonNullable<Window['Razorpay']>> {
  if (window.Razorpay) return window.Razorpay;
  await new Promise<void>((resolve, reject) => {
    if (document.querySelector(`script[src="${CHECKOUT_SCRIPT}"]`)) {
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = CHECKOUT_SCRIPT;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load Razorpay Checkout'));
    document.body.appendChild(s);
  });
  if (!window.Razorpay) throw new Error('Razorpay script loaded but window.Razorpay is missing');
  return window.Razorpay;
}

/** Where a therapist reaches a human when online checkout can't run. */
const BILLING_CONTACT_EMAIL =
  process.env['NEXT_PUBLIC_BILLING_CONTACT_EMAIL'] ?? 'shamil@cureo.city';

export function PlanCheckoutButton({ plan, label, variant = 'primary' }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Online payment isn't configured — offer the human path instead of a
  // dead error under the button (the capped screen must never be a dead end).
  const [contactFallback, setContactFallback] = useState<string | null>(null);

  const launch = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/billing/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      const body = (await res.json().catch(() => ({}))) as CreateCheckoutResponse & {
        error?: string;
        code?: string;
      };
      if (body.code === 'CHECKOUT_UNAVAILABLE') {
        setContactFallback(
          body.error ?? 'Online payment isn’t live yet — message us and we’ll set you up.',
        );
        return;
      }
      if (!res.ok) {
        setError(body.error ?? `Could not start checkout (HTTP ${res.status}).`);
        return;
      }
      const Razorpay = await ensureRazorpay();
      const checkout = new Razorpay({
        key: body.keyId,
        amount: body.amountInr * 100,
        currency: 'INR',
        name: 'Cureocity Mind',
        description: `${planLabel(plan)} subscription`,
        order_id: body.orderId,
        handler: () => {
          // Webhook is the source of truth; refresh server props +
          // poll briefly so the Plan page reflects the new state.
          router.refresh();
        },
        modal: { ondismiss: () => setBusy(false) },
      });
      checkout.open();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [plan, router]);

  return (
    <div>
      <button
        type="button"
        onClick={launch}
        disabled={busy}
        className={
          variant === 'secondary'
            ? 'w-full rounded-full border border-[var(--color-line)] bg-white px-5 py-2 text-sm font-medium text-[var(--color-ink-2)] hover:text-[var(--color-ink)] disabled:opacity-60'
            : 'w-full rounded-full bg-[var(--color-accent)] px-5 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-60'
        }
      >
        {busy ? 'Opening checkout…' : (label ?? 'Upgrade')}
      </button>
      {error && <p className="mt-2 text-xs text-[var(--color-warn)]">{error}</p>}
      {contactFallback && (
        <div className="mt-2 rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] p-3 text-xs text-[var(--color-ink-2)]">
          <p>{contactFallback}</p>
          <a
            href={`mailto:${BILLING_CONTACT_EMAIL}?subject=${encodeURIComponent(
              `Activate my ${planLabel(plan)} plan`,
            )}`}
            className="mt-1.5 inline-block font-semibold text-[var(--color-accent)] hover:underline"
          >
            Email {BILLING_CONTACT_EMAIL} →
          </a>
        </div>
      )}
    </div>
  );
}
