'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { PreparePanel } from './PreparePanel';
import { RescheduleModal } from './RescheduleModal';

export interface TodaySessionCardProps {
  session: {
    id: string;
    status: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW' | 'RESCHEDULED';
    scheduledAt: string;
    modality: string | null;
    kind: 'INTAKE' | 'TREATMENT' | 'REVIEW';
    clientId: string;
    clientName: string;
    /** Sprint 48 — seeded "Example" client; renders a warn badge. */
    clientIsDemo?: boolean;
    hasSignedNote: boolean;
    draftStatus: string | null;
    /** TS6 — how an IN_PROGRESS session was started (LIVE ⇒ resume the live
     *  scribe; anything else ⇒ resume via the batch record flow). */
    captureMode?: string | null;
  };
  /** TS6 — the therapist's preferred capture; picks the PRIMARY Start action
   *  (the other stays one tap away in the caret). Absent/LIVE ⇒ live. */
  defaultCapture?: 'LIVE' | 'BATCH';
  /** TS7.2 — `hero` is the full-screen "Up next" treatment (prep brief
   *  auto-open, thumb-sized Start); `row` is the compact timeline line for
   *  everything else. */
  variant?: 'hero' | 'row';
  /** TS7.4 — an instrument (e.g. "GAD-7") whose re-measure is overdue for
   *  this client; renders a chip linking to the Journey measure card. */
  dueMeasure?: string | null;
}

/**
 * Sprint 45 — one entry on the Today screen; TS7.2 reshaped it around the
 * "Up next" hero. At any moment exactly one session matters — it gets the
 * name in large type, the pre-session brief already open, and a Start
 * button sized for a thumb. The rest of the day renders as quiet rows whose
 * right edge states the one true thing about each session (Start / Resume /
 * ✓ signed / Sign ▸).
 */
export function TodaySessionCard({
  session,
  defaultCapture = 'LIVE',
  variant = 'row',
  dueMeasure = null,
}: TodaySessionCardProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<'no-show' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [startMenuOpen, setStartMenuOpen] = useState(false);
  const [rowMenuOpen, setRowMenuOpen] = useState(false);

  // TS6 — the two ways to start, doctor-style: the preferred one is the
  // primary button; the other lives one tap away. Live opens the scribe;
  // record-only goes to the batch flow (which reuses THIS booked session).
  const startOptions = {
    LIVE: {
      href: `/app/sessions/${session.id}/live?flash=1`,
      primaryLabel: '● Start session',
      menuLabel: '🎙 Live scribe',
      menuDesc: 'Transcript, note and copilot build as you talk.',
    },
    BATCH: {
      href: `/app?record=${session.clientId}`,
      primaryLabel: '⏺ Start recording',
      menuLabel: '⏺ Record only',
      menuDesc: 'Just records — the note generates when you finish.',
    },
  } as const;
  const primaryStart = startOptions[defaultCapture];
  const secondaryStart = startOptions[defaultCapture === 'LIVE' ? 'BATCH' : 'LIVE'];
  const resumeHref =
    session.captureMode === 'LIVE'
      ? `/app/sessions/${session.id}/live`
      : `/app?record=${session.clientId}`;

  async function markNoShow() {
    if (busy) return;
    if (!confirm(`Mark ${session.clientName}'s session as a no-show?`)) return;
    setBusy('no-show');
    setError(null);
    try {
      const res = await fetch(`/api/v1/sessions/${session.id}/no-show`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Failed (${res.status})`);
      }
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  // ------------------------------------------------------------------
  // Hero — the "Up next" treatment (SCHEDULED or IN_PROGRESS only).
  // ------------------------------------------------------------------
  if (variant === 'hero') {
    return (
      <>
        <Card className="border-[var(--color-accent)]/40 p-5 shadow-[0_8px_24px_rgba(45,95,77,0.10)]">
          <div className="flex items-baseline justify-between gap-3">
            <Link
              href={`/app/clients/${session.clientId}`}
              className="font-serif text-2xl font-medium text-[var(--color-ink)] hover:text-[var(--color-accent)]"
            >
              {session.clientName}
            </Link>
            <span className="font-mono text-base tabular-nums text-[var(--color-ink)]">
              {formatTime(session.scheduledAt)}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-[var(--color-ink-2)]">
            {session.kind.toLowerCase()}
            {session.modality ? ` · ${session.modality}` : ''}
            {session.status === 'IN_PROGRESS' ? ' · in progress' : ''}
            {session.clientIsDemo && (
              <Badge tone="warn" className="ml-2 align-middle">
                Example
              </Badge>
            )}
          </p>

          {/* The 0-tap prep read — auto-open on the one session that's next. */}
          <div className="mt-3">
            <PreparePanel clientId={session.clientId} defaultOpen />
          </div>

          {session.status === 'IN_PROGRESS' ? (
            <Link
              href={resumeHref}
              className="mt-4 block rounded-full bg-[var(--color-accent)] px-4 py-3.5 text-center text-base font-semibold text-white hover:bg-[var(--color-accent-hover)]"
            >
              Resume session
            </Link>
          ) : (
            <div className="relative mt-4">
              <div className="flex items-stretch">
                <Link
                  href={primaryStart.href}
                  className="flex-1 rounded-l-full bg-[var(--color-accent)] px-4 py-3.5 text-center text-base font-semibold text-white hover:bg-[var(--color-accent-hover)]"
                >
                  {primaryStart.primaryLabel}
                </Link>
                <button
                  type="button"
                  aria-label="More ways to start"
                  aria-expanded={startMenuOpen}
                  onClick={() => setStartMenuOpen((o) => !o)}
                  className="rounded-r-full border-l border-white/25 bg-[var(--color-accent)] px-4 text-base font-medium text-white hover:bg-[var(--color-accent-hover)]"
                >
                  ▾
                </button>
              </div>
              {startMenuOpen && (
                <div className="absolute right-0 top-full z-20 mt-1 w-64 overflow-hidden rounded-xl border border-[var(--color-line)] bg-white shadow-lg">
                  <Link
                    href={secondaryStart.href}
                    className="block w-full px-4 py-3 text-left hover:bg-[var(--color-surface-soft)]"
                    onClick={() => setStartMenuOpen(false)}
                  >
                    <span className="block text-sm font-medium text-[var(--color-ink)]">
                      {secondaryStart.menuLabel}
                    </span>
                    <span className="block text-xs text-[var(--color-ink-3)]">
                      {secondaryStart.menuDesc}
                    </span>
                  </Link>
                </div>
              )}
            </div>
          )}

          {session.status === 'SCHEDULED' && (
            <div className="mt-2 flex items-center justify-center gap-1">
              <button
                type="button"
                onClick={() => setRescheduleOpen(true)}
                disabled={busy !== null}
                className="rounded-full px-3 py-1.5 text-xs text-[var(--color-ink-2)] hover:bg-[var(--color-surface-soft)]"
              >
                Reschedule
              </button>
              <button
                type="button"
                onClick={() => void markNoShow()}
                disabled={busy !== null}
                className="rounded-full px-3 py-1.5 text-xs text-[var(--color-ink-2)] hover:bg-[var(--color-surface-soft)]"
              >
                {busy === 'no-show' ? 'Marking…' : 'No-show'}
              </button>
            </div>
          )}
          {error && (
            <p className="mt-2 text-xs text-[var(--color-warn)]" role="alert">
              {error}
            </p>
          )}
        </Card>
        <RescheduleModal
          open={rescheduleOpen}
          sessionId={session.id}
          clientName={session.clientName}
          currentScheduledAt={session.scheduledAt}
          onClose={() => setRescheduleOpen(false)}
        />
      </>
    );
  }

  // ------------------------------------------------------------------
  // Row — one quiet line for everything that isn't up next.
  // ------------------------------------------------------------------
  const muted =
    session.status === 'NO_SHOW' ||
    session.status === 'CANCELLED' ||
    session.status === 'RESCHEDULED';

  return (
    <>
      <div
        className={`flex items-center justify-between gap-3 rounded-xl border border-[var(--color-line-soft)] bg-white px-4 py-3 ${muted ? 'opacity-60' : ''}`}
      >
        <div className="flex min-w-0 items-baseline gap-3">
          <span className="shrink-0 font-mono text-sm tabular-nums text-[var(--color-ink-3)]">
            {formatTime(session.scheduledAt)}
          </span>
          <Link
            href={`/app/clients/${session.clientId}`}
            className="truncate text-sm font-medium text-[var(--color-ink)] hover:text-[var(--color-accent)]"
          >
            {session.clientName}
          </Link>
          <Badge tone={kindTone(session.kind)}>{session.kind.toLowerCase()}</Badge>
          {session.clientIsDemo && <Badge tone="warn">Example</Badge>}
          {dueMeasure && (
            // TS7.4 — measurement debt is visible where the day happens; the
            // link lands on the Journey card's one-tap send.
            <Link
              href={`/app/clients/${session.clientId}#care-measures`}
              className="rounded-full bg-[var(--color-warn-soft)] px-2.5 py-1 text-xs font-medium text-[var(--color-warn)] hover:underline"
            >
              {dueMeasure} due ▸
            </Link>
          )}
        </div>

        <div className="relative flex shrink-0 items-center gap-1.5">
          {session.status === 'SCHEDULED' && (
            <>
              <Link
                href={primaryStart.href}
                className="rounded-full bg-[var(--color-accent)] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[var(--color-accent-hover)]"
              >
                Start ▸
              </Link>
              <button
                type="button"
                aria-label={`More actions for ${session.clientName}`}
                aria-expanded={rowMenuOpen}
                onClick={() => setRowMenuOpen((o) => !o)}
                className="grid h-7 w-7 place-items-center rounded-full text-sm text-[var(--color-ink-3)] hover:bg-[var(--color-surface-soft)]"
              >
                ⋯
              </button>
              {rowMenuOpen && (
                <div className="absolute right-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-xl border border-[var(--color-line)] bg-white shadow-lg">
                  <Link
                    href={secondaryStart.href}
                    className="block px-4 py-2.5 text-left text-sm hover:bg-[var(--color-surface-soft)]"
                    onClick={() => setRowMenuOpen(false)}
                  >
                    {secondaryStart.menuLabel}
                  </Link>
                  <button
                    type="button"
                    className="block w-full px-4 py-2.5 text-left text-sm hover:bg-[var(--color-surface-soft)]"
                    onClick={() => {
                      setRowMenuOpen(false);
                      setRescheduleOpen(true);
                    }}
                  >
                    Reschedule
                  </button>
                  <button
                    type="button"
                    className="block w-full px-4 py-2.5 text-left text-sm hover:bg-[var(--color-surface-soft)]"
                    onClick={() => {
                      setRowMenuOpen(false);
                      void markNoShow();
                    }}
                  >
                    {busy === 'no-show' ? 'Marking…' : 'Mark no-show'}
                  </button>
                </div>
              )}
            </>
          )}

          {session.status === 'IN_PROGRESS' && (
            <Link
              href={resumeHref}
              className="rounded-full bg-[var(--color-accent)] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[var(--color-accent-hover)]"
            >
              Resume
            </Link>
          )}

          {session.status === 'COMPLETED' &&
            (session.hasSignedNote ? (
              <Link
                href={`/app/sessions/${session.id}`}
                className="text-xs font-medium text-[var(--color-ink-3)] hover:text-[var(--color-ink)]"
              >
                ✓ signed
              </Link>
            ) : session.draftStatus === 'COMPLETED' ? (
              // TS7.2 — the unsigned-note debt stays visible all day; the
              // link lands on the workspace where the Sign & send bar waits.
              <Link
                href={`/app/sessions/${session.id}`}
                className="rounded-full border border-[var(--color-accent)] px-3.5 py-1.5 text-xs font-semibold text-[var(--color-accent)] hover:bg-[var(--color-accent-soft)]"
              >
                Sign ▸
              </Link>
            ) : session.draftStatus === 'IN_PROGRESS' || session.draftStatus === 'PENDING' ? (
              <Link
                href={`/app/sessions/${session.id}`}
                className="text-xs text-[var(--color-ink-3)] hover:text-[var(--color-ink)]"
              >
                Note generating…
              </Link>
            ) : (
              <Link
                href={`/app/sessions/${session.id}`}
                className="text-xs font-medium text-[var(--color-ink-2)] hover:text-[var(--color-ink)]"
              >
                Open
              </Link>
            ))}

          {muted && (
            <>
              <span className="text-xs text-[var(--color-ink-3)]">
                {session.status.toLowerCase().replace(/_/g, ' ')}
              </span>
              <Link
                href={`/app/sessions/${session.id}`}
                className="text-xs font-medium text-[var(--color-ink-2)] hover:text-[var(--color-ink)]"
              >
                Open
              </Link>
            </>
          )}
        </div>
      </div>
      {error && (
        <p className="mt-1 px-4 text-xs text-[var(--color-warn)]" role="alert">
          {error}
        </p>
      )}
      <RescheduleModal
        open={rescheduleOpen}
        sessionId={session.id}
        clientName={session.clientName}
        currentScheduledAt={session.scheduledAt}
        onClose={() => setRescheduleOpen(false)}
      />
    </>
  );
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });
}

function kindTone(kind: 'INTAKE' | 'TREATMENT' | 'REVIEW'): 'accent' | 'muted' | 'default' {
  if (kind === 'INTAKE') return 'accent';
  if (kind === 'REVIEW') return 'muted';
  return 'default';
}
