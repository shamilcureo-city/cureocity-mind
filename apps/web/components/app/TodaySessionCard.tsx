'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { RescheduleModal } from './RescheduleModal';

export interface TodaySessionCardProps {
  session: {
    id: string;
    status:
      | 'SCHEDULED'
      | 'IN_PROGRESS'
      | 'COMPLETED'
      | 'CANCELLED'
      | 'NO_SHOW'
      | 'RESCHEDULED';
    scheduledAt: string;
    modality: string | null;
    kind: 'INTAKE' | 'TREATMENT' | 'REVIEW';
    clientId: string;
    clientName: string;
    hasSignedNote: boolean;
    draftStatus: string | null;
  };
}

/**
 * Sprint 45 — one row on the Today screen.
 *
 * The visible actions depend on session.status:
 *   SCHEDULED   → Start, Mark no-show, Reschedule
 *   IN_PROGRESS → Open session
 *   COMPLETED   → Open session (note state shown)
 *   NO_SHOW / CANCELLED / RESCHEDULED → muted display + Open
 *
 * Status transitions hit the new POST routes, then `router.refresh()`
 * re-runs the server query so the page reflects the new state without
 * a manual reload.
 */
export function TodaySessionCard({ session }: TodaySessionCardProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<'no-show' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);

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

  const muted =
    session.status === 'NO_SHOW' ||
    session.status === 'CANCELLED' ||
    session.status === 'RESCHEDULED';

  return (
    <>
      <Card className={`p-5 ${muted ? 'opacity-70' : ''}`}>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="font-mono text-base font-medium tabular-nums text-[var(--color-ink)]">
              {formatTime(session.scheduledAt)}
            </span>
            <Link
              href={`/app/clients/${session.clientId}`}
              className="text-base font-medium text-[var(--color-ink)] hover:text-[var(--color-accent)]"
            >
              {session.clientName}
            </Link>
            <Badge tone={kindTone(session.kind)}>{session.kind.toLowerCase()}</Badge>
            {session.modality && <Badge tone="muted">{session.modality}</Badge>}
            <Badge tone={statusTone(session.status)}>
              {session.status.toLowerCase().replace(/_/g, ' ')}
            </Badge>
            {session.status === 'COMPLETED' && (
              <span className="text-xs text-[var(--color-ink-3)]">
                {session.hasSignedNote
                  ? '✓ Note signed'
                  : session.draftStatus === 'COMPLETED'
                    ? 'Draft ready'
                    : session.draftStatus === 'IN_PROGRESS'
                      ? 'Note generating…'
                      : '—'}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {session.status === 'SCHEDULED' && (
              <>
                <Link
                  href={`/app/sessions/${session.id}`}
                  className="rounded-full bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)]"
                >
                  Start session
                </Link>
                <Button
                  variant="secondary"
                  onClick={() => setRescheduleOpen(true)}
                  disabled={busy !== null}
                >
                  Reschedule
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => void markNoShow()}
                  disabled={busy !== null}
                >
                  {busy === 'no-show' ? 'Marking…' : 'No-show'}
                </Button>
              </>
            )}
            {session.status === 'IN_PROGRESS' && (
              <Link
                href={`/app/sessions/${session.id}`}
                className="rounded-full bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)]"
              >
                Resume
              </Link>
            )}
            {(session.status === 'COMPLETED' ||
              session.status === 'NO_SHOW' ||
              session.status === 'CANCELLED' ||
              session.status === 'RESCHEDULED') && (
              <Link
                href={`/app/sessions/${session.id}`}
                className="rounded-full border border-[var(--color-line)] bg-white px-4 py-2 text-sm font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
              >
                Open
              </Link>
            )}
          </div>
        </div>
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

function statusTone(
  status: TodaySessionCardProps['session']['status'],
): 'accent' | 'warn' | 'muted' | 'default' {
  if (status === 'IN_PROGRESS') return 'warn';
  if (status === 'COMPLETED') return 'accent';
  if (status === 'NO_SHOW' || status === 'CANCELLED' || status === 'RESCHEDULED') return 'muted';
  return 'default';
}
