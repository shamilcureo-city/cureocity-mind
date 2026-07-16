'use client';

import type { CareResource } from './SafetyStrip';

/**
 * §2 layer 4 — the full-screen crisis takeover. Renders the moment a
 * `crisis_stop` lands (keyword screen, flag_crisis tool, or the user's
 * own tap). The session is already terminated server-side by the time
 * this shows; nothing here can resume it.
 */
export function CrisisTakeover({
  resources,
  trustedContact,
}: {
  resources: CareResource[];
  trustedContact: { name: string; phone: string | null } | null;
}) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[var(--color-bg)]">
      <div className="bg-[var(--color-warn)] px-5 py-6 text-white">
        <h1 className="font-serif text-2xl font-semibold">Let&apos;s pause here.</h1>
        <p className="mt-2 text-[15px] opacity-95">
          What you just shared matters — and it deserves a person, not an AI. The session has ended.
        </p>
      </div>
      <div className="mx-auto max-w-md px-5 py-5">
        <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
          Call someone now — free, confidential
        </div>
        <div className="mt-2 space-y-2">
          {resources.map((r) => (
            <a
              key={r.number}
              href={`tel:${r.number}`}
              className="flex items-center justify-between rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3"
            >
              <span>
                <span className="block font-semibold">{r.name}</span>
                <span className="block text-xs text-[var(--color-ink-3)]">{r.hours}</span>
              </span>
              <span className="font-bold text-[var(--color-warn)]">📞 {r.number}</span>
            </a>
          ))}
          {trustedContact?.phone ? (
            <a
              href={`tel:${trustedContact.phone}`}
              className="flex items-center justify-between rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3"
            >
              <span>
                <span className="block font-semibold">{trustedContact.name}</span>
                <span className="block text-xs text-[var(--color-ink-3)]">
                  your trusted contact — only you can call
                </span>
              </span>
              <span className="font-bold text-[var(--color-accent)]">📞 Call</span>
            </a>
          ) : null}
        </div>
        <p className="mt-5 text-center text-xs text-[var(--color-ink-3)]">
          Pause here for now — a quick check-in brings you back. You matter more than a streak.
        </p>
      </div>
    </div>
  );
}
