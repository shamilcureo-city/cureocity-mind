'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CareCheckoutResponse } from '@cureocity/contracts';
import { Button } from '@/components/ui/Button';

/**
 * CG5 — the trial button + session-pack checkout (docs/CARE_GROWTH_SYSTEM.md §7).
 * The trial collects NO payment method (sidesteps UPI-mandate friction) and
 * ends silently; the pack rides the same Razorpay order flow as Plus. Both
 * only render where suppression allows (the server page decides).
 */

export function CareTrialButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/care/billing/trial', { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Could not start the trial');
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => void start()}
        className="w-full text-center text-[13px] font-semibold text-[var(--color-accent)] underline-offset-2 hover:underline"
      >
        {busy ? 'Starting…' : 'Or try Plus free for 7 days — no card, it ends on its own'}
      </button>
      {error ? <p className="mt-1 text-xs text-[var(--color-warn)]">{error}</p> : null}
    </div>
  );
}

const CHECKOUT_SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js';
interface PackRazorpayOptions {
  key: string;
  amount: number;
  currency: 'INR';
  name: string;
  description?: string;
  order_id: string;
  handler?: () => void;
  modal?: { ondismiss?: () => void };
}
type PackRazorpayCtor = new (options: PackRazorpayOptions) => { open(): void };

async function ensureRazorpay(): Promise<PackRazorpayCtor> {
  const w = window as unknown as { Razorpay?: PackRazorpayCtor };
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

export function CarePackCheckout({ priceInr }: { priceInr: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function launch(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/care/billing/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sku: 'SESSION_PACK' }),
      });
      const body = (await res.json().catch(() => ({}))) as CareCheckoutResponse & {
        error?: string;
      };
      if (!res.ok) {
        setError(body.error ?? 'Could not start the payment — nothing was charged.');
        return;
      }
      const Razorpay = await ensureRazorpay();
      new Razorpay({
        key: body.keyId,
        amount: body.amountInr * 100,
        currency: 'INR',
        name: 'Cureocity Care',
        description: 'Session pack — 2 sessions, this week',
        order_id: body.orderId,
        handler: () => {
          setDone(true);
          router.refresh();
        },
        modal: { ondismiss: () => setBusy(false) },
      }).open();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p className="text-sm font-semibold text-[var(--color-accent)]">
        Payment received — your 2 extra sessions unlock as soon as it confirms (a few seconds).
      </p>
    );
  }
  return (
    <div>
      <Button variant="secondary" size="sm" disabled={busy} onClick={() => void launch()}>
        {busy ? 'Opening…' : `Add 2 sessions — ₹${priceInr}`}
      </Button>
      {error ? <p className="mt-1 text-xs text-[var(--color-warn)]">{error}</p> : null}
    </div>
  );
}
