'use client';

import { useEffect, useState } from 'react';
import type { ReferralStatus } from '@cureocity/contracts';
import { Card } from '../ui/Card';

/**
 * Sprint 56 (Lever 3b) — "refer a peer" card on the Plan page. Loads the
 * therapist's code lazily from GET /billing/referral and offers a
 * copy-able share link. Compounds with the patient-artefact watermark:
 * both turn existing users into a distribution channel.
 */
const MARKETING_URL = process.env['NEXT_PUBLIC_MARKETING_URL'] ?? 'https://cureocitymind.com';

export function ReferralCard() {
  const [status, setStatus] = useState<ReferralStatus | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    void fetch('/api/v1/billing/referral')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d) setStatus(d as ReferralStatus);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (!status) {
    return (
      <Card className="p-7">
        <h3 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">Refer a peer</h3>
        <p className="mt-2 text-sm text-[var(--color-ink-3)]">Loading your referral link…</p>
      </Card>
    );
  }

  const link = `${MARKETING_URL}/?ref=${status.code}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — the input is selectable as a fallback */
    }
  }

  return (
    <Card className="p-7">
      <h3 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">Refer a peer</h3>
      <p className="mt-2 text-sm text-[var(--color-ink-2)]">
        Share your link. Your peer gets <strong>{status.referredFreeDays} days of Pro free</strong>{' '}
        when they sign up, and you get <strong>{status.referrerRewardDays} days free</strong> when
        they upgrade to a paid plan.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          readOnly
          value={link}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-2 font-mono text-xs text-[var(--color-ink-2)]"
        />
        <button
          type="button"
          onClick={copy}
          className="rounded-full bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)]"
        >
          {copied ? 'Copied!' : 'Copy link'}
        </button>
      </div>
      <p className="mt-3 text-xs text-[var(--color-ink-3)]">
        {status.referredCount} referred · {status.rewardedCount} upgraded
      </p>
    </Card>
  );
}
