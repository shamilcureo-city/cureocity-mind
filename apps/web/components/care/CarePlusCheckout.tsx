'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CareCheckoutResponse } from '@cureocity/contracts';
import { Button } from '@/components/ui/Button';

/**
 * CG3 — the Care Plus checkout launcher (the therapist PlanCheckoutButton
 * pattern): mint the order, inject checkout.razorpay.com/v1/checkout.js
 * once, open the widget, then POLL /care/billing/me — the webhook is the
 * source of truth for "did it succeed", never the success callback.
 * Failure copy is non-punitive by policy: access never changes on a
 * failed payment.
 */

// The Window.Razorpay global is declared by the therapist-side
// PlanCheckoutButton — don't redeclare it here (conflicting ambient types);
// cast structurally instead.
interface CareRazorpayOptions {
  key: string;
  amount: number;
  currency: 'INR';
  name: string;
  description?: string;
  order_id: string;
  handler?: (response: { razorpay_payment_id: string }) => void;
  modal?: { ondismiss?: () => void };
}
interface CareRazorpayInstance {
  open(): void;
}
type CareRazorpayCtor = new (options: CareRazorpayOptions) => CareRazorpayInstance;

const CHECKOUT_SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js';

async function ensureRazorpay(): Promise<CareRazorpayCtor> {
  const w = window as unknown as { Razorpay?: CareRazorpayCtor };
  if (w.Razorpay) return w.Razorpay;
  await new Promise<void>((resolve, reject) => {
    if (document.querySelector(`script[src="${CHECKOUT_SCRIPT}"]`)) {
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = CHECKOUT_SCRIPT;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load the payment window'));
    document.body.appendChild(s);
  });
  if (!w.Razorpay) throw new Error('Payment window unavailable');
  return w.Razorpay;
}

export function CarePlusCheckout({ priceInr }: { priceInr: number }) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const pollUntilPlus = useCallback(() => {
    setConfirming(true);
    let tries = 0;
    pollRef.current = setInterval(() => {
      tries += 1;
      void fetch('/api/v1/care/billing/me')
        .then((r) => r.json())
        .then((b: { effectiveTier?: string }) => {
          if (b.effectiveTier === 'plus') {
            if (pollRef.current) clearInterval(pollRef.current);
            setConfirming(false);
            setDone(true);
          } else if (tries > 20) {
            if (pollRef.current) clearInterval(pollRef.current);
            setConfirming(false);
            setError(
              'Payment received — your upgrade is being confirmed. If this page doesn’t update in a minute, refresh it; nothing is lost.',
            );
          }
        })
        .catch(() => undefined);
    }, 3000);
  }, []);

  async function launch(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/care/billing/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sku: 'PLUS_MONTHLY' }),
      });
      const body = (await res.json().catch(() => ({}))) as CareCheckoutResponse & {
        error?: string;
      };
      if (!res.ok) {
        setError(body.error ?? 'Could not start the payment — nothing was charged.');
        return;
      }
      const Razorpay = await ensureRazorpay();
      const checkout = new Razorpay({
        key: body.keyId,
        amount: body.amountInr * 100,
        currency: 'INR',
        name: 'Cureocity Care',
        description: 'Care Plus — 30 days',
        order_id: body.orderId,
        handler: () => pollUntilPlus(),
        modal: { ondismiss: () => setBusy(false) },
      });
      checkout.open();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p className="text-sm font-semibold text-[var(--color-accent)]">
        You&apos;re on Care Plus — up to 4 sessions a week for the next 30 days. Everything you
        already had stays yours.
      </p>
    );
  }

  return (
    <div>
      <Button className="w-full" disabled={busy || confirming} onClick={() => void launch()}>
        {confirming ? 'Confirming your payment…' : busy ? 'Opening…' : `Get Plus — ₹${priceInr}`}
      </Button>
      <p className="mt-1.5 text-center text-[11px] text-[var(--color-ink-3)]">
        30 days · UPI or card · nothing recurring — it ends on its own and Free continues.
      </p>
      {error ? <p className="mt-2 text-sm text-[var(--color-warn)]">{error}</p> : null}
    </div>
  );
}
