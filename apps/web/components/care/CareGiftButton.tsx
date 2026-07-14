'use client';

import { useState } from 'react';

/**
 * CG6 — gift-a-session (docs/CARE_GROWTH_SYSTEM.md §8): generosity, not
 * evangelism. Fetches the lazily-provisioned code, then opens WhatsApp
 * with a message that frames the sender as thoughtful, not ill. The
 * friend's first week gets 3 sessions; the sender's credit lands when the
 * friend completes intake.
 */
export function CareGiftButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function gift(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/care/referral');
      const body = (await res.json().catch(() => ({}))) as { code?: string; error?: string };
      if (!res.ok || !body.code) throw new Error(body.error ?? 'Could not get your gift code');
      const link = `${window.location.origin}/care/login?ref=${body.code}`;
      const message =
        `I got you a session on Cureocity Care — an AI therapist you can actually talk to, in your own language. ` +
        `They're upfront that it's an AI, which is weirdly why I trust it. ` +
        `This link gives your first week 3 free sessions: ${link}`;
      window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span>
      <button
        type="button"
        disabled={busy}
        onClick={() => void gift()}
        className="text-[13px] font-semibold text-[var(--color-accent)] underline-offset-2 hover:underline"
      >
        {busy ? 'Getting your code…' : 'Gift a friend their first session →'}
      </button>
      {error ? <span className="ml-2 text-xs text-[var(--color-warn)]">{error}</span> : null}
    </span>
  );
}
