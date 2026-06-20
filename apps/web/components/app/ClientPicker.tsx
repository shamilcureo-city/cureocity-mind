'use client';

import { useMemo, useState } from 'react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

export interface ClientTileEntry {
  id: string;
  fullName: string;
  preferredModality: string | null;
  /** ISO timestamp of most recent COMPLETED session, or null. */
  lastCompletedSessionAt: string | null;
  /** Sprint 48 — Example/showcase client; renders a warn badge on the tile. */
  isDemo?: boolean;
}

interface Props {
  clients: ClientTileEntry[];
  onPickClient: (client: { id: string; fullName: string }) => void;
  onNewClient: () => void;
  onDictation: () => void;
  onUpload: () => void;
}

/** Recent = client with most recent completed session within this window. */
const RECENT_WINDOW_DAYS = 14;
const MAX_RECENT_TILES = 6;

/**
 * Sprint 23 — client-led record entry surface. Replaces the old
 * 4-card "pick a capture mode" grid. The therapist picks who they're
 * with first (the dominant mental model) and confirms the capture
 * method one click later in `RecordConfirmStrip`.
 *
 * Layout:
 *   1. Recent tiles (clients with a COMPLETED session in the last 14d)
 *   2. Search across all active clients (collapses recent tiles when
 *      a query is entered)
 *   3. "+ New client" CTA — primary, peer to the search
 *   4. Secondary actions: dictation + upload (different intent — not
 *      "record live with a client")
 */
export function ClientPicker({ clients, onPickClient, onNewClient, onDictation, onUpload }: Props) {
  const [query, setQuery] = useState('');

  const sorted = useMemo(() => {
    return [...clients].sort((a, b) => {
      const ta = a.lastCompletedSessionAt ? new Date(a.lastCompletedSessionAt).getTime() : 0;
      const tb = b.lastCompletedSessionAt ? new Date(b.lastCompletedSessionAt).getTime() : 0;
      if (ta === tb) return a.fullName.localeCompare(b.fullName);
      return tb - ta;
    });
  }, [clients]);

  const recent = useMemo(() => {
    const cutoff = Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    return sorted
      .filter(
        (c) => c.lastCompletedSessionAt && new Date(c.lastCompletedSessionAt).getTime() >= cutoff,
      )
      .slice(0, MAX_RECENT_TILES);
  }, [sorted]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return sorted.filter((c) => c.fullName.toLowerCase().includes(q)).slice(0, 12);
  }, [sorted, query]);

  const showRecent = !query.trim();

  return (
    <>
      <section>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-accent)]">
              Record
            </p>
            <h2 className="mt-1 font-serif text-2xl">Who are you with today?</h2>
          </div>
          <Button onClick={onNewClient}>+ New client</Button>
        </div>

        <div className="mb-5">
          <input
            type="text"
            placeholder="Search clients…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full max-w-md rounded-xl border border-[var(--color-line)] bg-white px-4 py-2.5 text-sm placeholder:text-[var(--color-ink-3)] focus:border-[var(--color-ink)] focus:outline-none"
          />
        </div>

        {showRecent && recent.length > 0 && (
          <div>
            <p className="mb-3 text-xs uppercase tracking-wide text-[var(--color-ink-3)]">Recent</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {recent.map((c) => (
                <ClientTile key={c.id} entry={c} onPick={onPickClient} />
              ))}
            </div>
          </div>
        )}

        {!showRecent && (
          <div>
            {filtered.length === 0 ? (
              <Card className="p-6 text-sm text-[var(--color-ink-2)]">
                No clients match &ldquo;{query}&rdquo;.
              </Card>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {filtered.map((c) => (
                  <ClientTile key={c.id} entry={c} onPick={onPickClient} />
                ))}
              </div>
            )}
          </div>
        )}

        {showRecent && recent.length === 0 && clients.length > 0 && (
          <Card className="p-6 text-sm text-[var(--color-ink-2)]">
            No recent sessions — use search or start with{' '}
            <button
              type="button"
              onClick={onNewClient}
              className="text-[var(--color-accent)] underline"
            >
              + New client
            </button>
            .
          </Card>
        )}

        {clients.length === 0 && (
          <Card className="p-8 text-center">
            <p className="font-serif text-xl">No clients yet.</p>
            <p className="mt-2 text-sm text-[var(--color-ink-2)]">
              Start with someone new — add their name and consent, and record their intake.
            </p>
            <div className="mt-4">
              <Button onClick={onNewClient}>+ New client</Button>
            </div>
          </Card>
        )}
      </section>

      <section className="mt-8 border-t border-[var(--color-line-soft)] pt-6">
        <p className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
          Or, post-session
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={onDictation}
            className="rounded-xl border border-[var(--color-line)] bg-white px-4 py-2.5 text-sm font-medium text-[var(--color-ink)] hover:border-[var(--color-ink)]"
          >
            Record a summary
          </button>
          <button
            type="button"
            onClick={onUpload}
            className="rounded-xl border border-[var(--color-line)] bg-white px-4 py-2.5 text-sm font-medium text-[var(--color-ink)] hover:border-[var(--color-ink)]"
          >
            Upload audio file
          </button>
        </div>
        <p className="mt-2 text-xs text-[var(--color-ink-3)]">
          For dictating notes after a session, or transcribing a recording from elsewhere.
        </p>
      </section>
    </>
  );
}

function ClientTile({
  entry,
  onPick,
}: {
  entry: ClientTileEntry;
  onPick: (c: { id: string; fullName: string }) => void;
}) {
  const subline = buildSubline(entry);
  return (
    <button
      type="button"
      onClick={() => onPick({ id: entry.id, fullName: entry.fullName })}
      className="group flex flex-col items-start rounded-2xl border border-[var(--color-line)] bg-white px-4 py-4 text-left transition-colors hover:border-[var(--color-ink)] hover:shadow-[0_18px_44px_-28px_rgba(15,27,42,0.18)]"
    >
      <span className="flex flex-wrap items-center gap-2">
        <span aria-hidden className="h-2 w-2 rounded-full bg-[var(--color-accent)]" />
        <span className="font-medium text-[var(--color-ink)]">{entry.fullName}</span>
        {entry.isDemo && (
          <span className="rounded-full bg-[var(--color-warn-soft)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--color-warn)]">
            Example
          </span>
        )}
      </span>
      <span className="mt-1.5 text-xs text-[var(--color-ink-3)]">{subline}</span>
    </button>
  );
}

function buildSubline(entry: ClientTileEntry): string {
  // Two facts on the tile: modality hint + last-session relative time.
  // Authoritative kind comes from the confirm strip (one click away),
  // so the tile only shows what's free from the Record-page query.
  const parts: string[] = [];
  if (entry.preferredModality) parts.push(entry.preferredModality);
  if (entry.lastCompletedSessionAt)
    parts.push(`last ${formatRelative(entry.lastCompletedSessionAt)}`);
  else parts.push('no sessions yet');
  return parts.join(' · ');
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'recently';
  const diff = Date.now() - then;
  const day = 24 * 60 * 60 * 1000;
  if (diff < day) return 'today';
  if (diff < 2 * day) return 'yesterday';
  const days = Math.round(diff / day);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  return months === 1 ? '1 mo ago' : `${months} mo ago`;
}
