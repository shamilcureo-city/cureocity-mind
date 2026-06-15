'use client';

import Link from 'next/link';
import { PLAN_CATALOG } from '@cureocity/contracts';

/**
 * Sprint 53 — UpgradeModal.
 *
 * Renders when the session-create gate returns 402 with code
 * TRIAL_CAP_REACHED. Three creation surfaces hit that gate
 * (RecordConfirmStrip, NewClientForm, ScheduleSessionPanel); each
 * captures the response and shows this modal.
 *
 * Keep it tight — copy + CTA to the Plan page where the real
 * checkout lives. We deliberately don't embed Razorpay Checkout
 * here so the modal stays a lightweight overlay.
 */
interface Props {
  open: boolean;
  onClose: () => void;
  trialCap?: number;
  upgradeUrl?: string;
}

export function UpgradeModal({ open, onClose, trialCap = 10, upgradeUrl = '/app/settings/plan' }: Props) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-3xl border border-[var(--color-line)] bg-white p-7 shadow-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-accent)]">
          Trial cap reached
        </p>
        <h2 className="mt-2 font-serif text-2xl text-[var(--color-ink)]">
          Time to upgrade to keep recording
        </h2>
        <p className="mt-3 text-sm text-[var(--color-ink-2)]">
          You&rsquo;ve used all {trialCap} of your free trial sessions. Your existing notes, shares,
          and the AI Copilot still work — only new session recording is paused.
        </p>
        <p className="mt-3 text-sm text-[var(--color-ink-2)]">
          Plans start at ₹{PLAN_CATALOG.TRAINEE_MONTHLY.defaultPriceInr.toLocaleString('en-IN')}/month;
          most therapists choose Pro at ₹
          {PLAN_CATALOG.PRO_MONTHLY.defaultPriceInr.toLocaleString('en-IN')}/month for unlimited
          sessions.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-[var(--color-line)] bg-white px-4 py-2 text-sm font-medium text-[var(--color-ink-2)] hover:text-[var(--color-ink)]"
          >
            Not now
          </button>
          <Link
            href={upgradeUrl}
            className="rounded-full bg-[var(--color-accent)] px-5 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)]"
            onClick={onClose}
          >
            See plans
          </Link>
        </div>
      </div>
    </div>
  );
}
