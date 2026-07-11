'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { BillingEntitlement } from '@cureocity/contracts';
import { Button } from '../ui/Button';
import { UpgradeModal } from './UpgradeModal';
import { useModalA11y } from '@/lib/use-modal-a11y';

export interface WalkInClient {
  id: string;
  fullName: string;
}

interface Props {
  clients: WalkInClient[];
  /** Clients with a session today / in the look-ahead — floated to the top. */
  recentClientIds: string[];
  /** TS6 — the therapist's preferred capture decides where a tap lands. */
  defaultCapture: 'LIVE' | 'BATCH';
}

/**
 * TS7.3 — the two-tap walk-in. Walk-ins are the Indian solo-practice norm,
 * not the exception, but starting one used to mean Record tab → picker →
 * confirm strip → start (4-5 taps). Now: "+ Walk-in" → tap the client.
 *
 * On tap, live-preference therapists get a session created here
 * (startNow reuses today's booked row if one exists — no duplicates) and
 * land in the live scribe with the mic arming; batch-preference therapists
 * go to the record flow, which owns creation + consent recovery already.
 * Every default (kind, modality, language) comes from the existing
 * server-side cascade — nothing to fill in.
 */
export function WalkInSheet({ clients, recentClientIds, defaultCapture }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [upgradePrompt, setUpgradePrompt] = useState<{
    variant: 'TRIAL_CAP' | 'PLAN_CAP';
    entitlement: BillingEntitlement;
  } | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  useModalA11y(open, sheetRef, () => setOpen(false));

  const recent = useMemo(() => new Set(recentClientIds), [recentClientIds]);
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? clients.filter((c) => c.fullName.toLowerCase().includes(q)) : clients;
    // Recents float; both groups keep their alphabetical order.
    return [
      ...filtered.filter((c) => recent.has(c.id)),
      ...filtered.filter((c) => !recent.has(c.id)),
    ];
  }, [clients, query, recent]);

  async function pick(clientId: string): Promise<void> {
    if (busyId) return;
    setError(null);
    if (defaultCapture === 'BATCH') {
      // The record flow owns session creation, consent recovery and the
      // billing gate — just take the client there.
      router.push(`/app?record=${clientId}`);
      return;
    }
    setBusyId(clientId);
    try {
      const res = await fetch('/api/v1/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          scheduledAt: new Date().toISOString(),
          startNow: true,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          code?: string;
          entitlement?: BillingEntitlement;
        };
        if (
          res.status === 402 &&
          (body.code === 'TRIAL_CAP_REACHED' || body.code === 'PLAN_CAP_REACHED') &&
          body.entitlement
        ) {
          setUpgradePrompt({
            variant: body.code === 'TRIAL_CAP_REACHED' ? 'TRIAL_CAP' : 'PLAN_CAP',
            entitlement: body.entitlement,
          });
          return;
        }
        throw new Error(body.error ?? `Could not start (${res.status})`);
      }
      const session = (await res.json()) as { id: string };
      router.push(`/app/sessions/${session.id}/live?flash=1`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        + Walk-in
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center md:p-4">
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="absolute inset-0"
          />
          <div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-label="Walk-in — who’s here?"
            className="relative max-h-[80vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 pb-8 shadow-2xl md:rounded-2xl md:pb-5"
          >
            <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-[var(--color-line)] md:hidden" />
            <h2 className="font-serif text-xl">Walk-in — who’s here?</h2>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search clients…"
              className="mt-3 w-full rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] px-3 py-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
            />
            {error && (
              <p className="mt-2 text-xs text-[var(--color-warn)]" role="alert">
                {error}
              </p>
            )}
            <ul className="mt-2 divide-y divide-[var(--color-line-soft)]">
              {list.length === 0 && (
                <li className="py-6 text-center text-sm text-[var(--color-ink-3)]">
                  No matching client.
                </li>
              )}
              {list.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => void pick(c.id)}
                    disabled={busyId !== null}
                    className="flex w-full items-center justify-between gap-3 px-1 py-3 text-left hover:bg-[var(--color-surface-soft)]"
                  >
                    <span className="flex items-center gap-2.5">
                      <span className="grid h-8 w-8 place-items-center rounded-full bg-[var(--color-accent-soft)] text-xs font-bold text-[var(--color-accent)]">
                        {initials(c.fullName)}
                      </span>
                      <span className="text-sm font-medium text-[var(--color-ink)]">
                        {c.fullName}
                      </span>
                      {recent.has(c.id) && (
                        <span className="text-[10px] uppercase tracking-wide text-[var(--color-ink-3)]">
                          recent
                        </span>
                      )}
                    </span>
                    <span className="text-xs font-medium text-[var(--color-accent)]">
                      {busyId === c.id
                        ? 'Starting…'
                        : defaultCapture === 'LIVE'
                          ? '▸ live'
                          : '▸ record'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <Link
              href="/app/clients"
              className="mt-3 block rounded-full border border-[var(--color-line)] bg-white px-4 py-2.5 text-center text-sm font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
            >
              + New client
            </Link>
          </div>
        </div>
      )}

      {upgradePrompt && (
        <UpgradeModal
          open
          onClose={() => setUpgradePrompt(null)}
          variant={upgradePrompt.variant}
          entitlement={upgradePrompt.entitlement}
        />
      )}
    </>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}
