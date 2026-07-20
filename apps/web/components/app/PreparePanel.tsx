'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type {
  AgreementFollowUp,
  PrepareSummaryV1,
  SessionAgreementDto,
} from '@cureocity/contracts';
import { Badge } from '../ui/Badge';

/**
 * Sprint 50 — Prepare panel on the Today screen.
 *
 * Expands inside a `TodaySessionCard`. Lazy-fetches the cached pre-
 * session brief + journey signals + homework + open crisis flags so
 * the Today page query stays lean (no N+1 — each card only fetches
 * when expanded).
 *
 * Never triggers a Pass-5 generation on its own; the "Generate fresh
 * brief" button explicitly hits the existing `/pre-session-brief`
 * route, which the therapist sees billed as a Gemini call.
 */

interface Props {
  clientId: string;
  /** Optional initial open state — defaults to closed (fetch on click). */
  defaultOpen?: boolean;
}

export function PreparePanel({ clientId, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const [data, setData] = useState<PrepareSummaryV1 | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/clients/${clientId}/prepare`, { cache: 'no-store' });
      const body = (await res.json().catch(() => ({}))) as PrepareSummaryV1 & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setData(body);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    if (open && data === null && !loading) void load();
  }, [open, data, loading, load]);

  async function generateFreshBrief() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/clients/${clientId}/pre-session-brief?refresh=1`, {
        cache: 'no-store',
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      // Re-fetch the summary so the cached-brief block flips to the
      // fresh content.
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="mt-3 border-t border-[var(--color-line-soft)] pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-[var(--color-ink-3)] hover:text-[var(--color-ink)]"
      >
        <span aria-hidden>{open ? '▾' : '▸'}</span>
        Prepare
      </button>
      {open && (
        <div className="mt-3 space-y-4">
          {loading && !data && (
            <p className="text-sm text-[var(--color-ink-3)]">Pulling the prep view…</p>
          )}
          {error && (
            <p className="rounded-xl border border-[var(--color-warn-border)] bg-[var(--color-warn-bg)] p-3 text-xs text-[var(--color-warn)]">
              {error}
            </p>
          )}
          {data && (
            <PrepareBody data={data} onGenerate={generateFreshBrief} generating={generating} />
          )}
        </div>
      )}
    </div>
  );
}

function PrepareBody({
  data,
  onGenerate,
  generating,
}: {
  data: PrepareSummaryV1;
  onGenerate: () => void | Promise<void>;
  generating: boolean;
}) {
  const { cachedBrief, briefIsStale, journey, homework, openCrises, lastCompletedSessionId } = data;
  return (
    <div className="space-y-4 text-sm">
      {openCrises.length > 0 && (
        <div className="rounded-xl border-2 border-[var(--color-warn-border)] bg-[var(--color-warn-bg)] p-3 text-xs text-[var(--color-warn)]">
          <strong>Open crisis flag(s) — start with a safety check:</strong>
          <ul className="mt-1 list-disc pl-5">
            {openCrises.map((c) => (
              <li key={c.kind}>
                {c.kind.replace(/_/g, ' ')} · {c.severity} · last seen{' '}
                {new Date(c.lastSeenAt).toLocaleDateString('en-IN', {
                  month: 'short',
                  day: 'numeric',
                })}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* SL2 — the thread: what was agreed last session, marked at a glance
          before the client walks in. Follow-up persists to the agreement row
          (the Close surface's counterpart). */}
      {data.lastAgreements.length > 0 && <AgreementsThread agreements={data.lastAgreements} />}

      {data.formulationSnapshot && (
        <section className="rounded-xl border border-[var(--color-line-soft)] bg-white/40 p-3">
          <p className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
            Formulation v{data.formulationSnapshot.version}
          </p>
          {data.formulationSnapshot.headline && (
            <p className="mt-1 text-xs leading-relaxed text-[var(--color-ink-2)]">
              {data.formulationSnapshot.headline}
            </p>
          )}
          {data.formulationSnapshot.cycleLine && (
            <p className="mt-1 text-[11px] text-[var(--color-ink-3)]">
              {data.formulationSnapshot.cycleLine}
            </p>
          )}
        </section>
      )}

      <section className="flex flex-wrap items-baseline gap-2">
        <Badge tone="muted">{journey.stage.replace(/_/g, ' ').toLowerCase()}</Badge>
        {journey.activePlan && (
          <span className="text-xs text-[var(--color-ink-3)]">
            Plan v{journey.activePlan.version} · {journey.activePlan.goalsAchieved}/
            {journey.activePlan.goalsTotal} goals
          </span>
        )}
        {journey.instrumentChanges.map((c) => (
          <span
            key={c.instrumentKey}
            className="rounded-full bg-[var(--color-surface)] px-3 py-0.5 text-xs text-[var(--color-ink-2)]"
          >
            {instrumentLabel(c.instrumentKey)} {c.baselineScore}→{c.latestScore} ·{' '}
            {verdictChip(c.verdict)}
          </span>
        ))}
      </section>

      {journey.nextBestAction && (
        <section className="rounded-xl border border-[var(--color-line-soft)] bg-white/40 p-3">
          <p className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
            Next best action
          </p>
          <p className="mt-1 font-medium text-[var(--color-ink)]">{journey.nextBestAction.title}</p>
          <p className="mt-0.5 text-xs text-[var(--color-ink-2)]">
            {journey.nextBestAction.detail}
          </p>
          {journey.nextBestAction.ctaHref && (
            <Link
              href={journey.nextBestAction.ctaHref}
              className="mt-2 inline-block text-xs font-medium text-[var(--color-accent)] hover:underline"
            >
              {journey.nextBestAction.ctaLabel ?? 'Open'} →
            </Link>
          )}
        </section>
      )}

      <section>
        <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
            Pre-session brief
          </p>
          <div className="flex items-center gap-2">
            {cachedBrief && briefIsStale && (
              <span className="text-[10px] uppercase tracking-wide text-[var(--color-warn)]">
                Stale — from before last session
              </span>
            )}
            <button
              type="button"
              onClick={onGenerate}
              disabled={generating}
              className="rounded-full border border-[var(--color-line)] bg-white px-3 py-1 text-xs font-medium text-[var(--color-ink-2)] hover:text-[var(--color-ink)] disabled:opacity-60"
            >
              {generating ? 'Generating…' : cachedBrief ? 'Regenerate' : 'Generate fresh brief'}
            </button>
          </div>
        </div>
        {cachedBrief ? (
          <div className="space-y-2 rounded-xl border border-[var(--color-line-soft)] bg-white/40 p-3">
            <p className="font-serif text-[var(--color-ink)]">{cachedBrief.contextLine}</p>
            <p className="text-xs leading-relaxed text-[var(--color-ink-2)]">
              {cachedBrief.todaysFocus}
            </p>
            {cachedBrief.openingLine && (
              <p className="text-xs italic text-[var(--color-ink-2)]">
                Open with: &ldquo;{cachedBrief.openingLine}&rdquo;
              </p>
            )}
          </div>
        ) : (
          <p className="text-xs text-[var(--color-ink-3)]">
            No cached brief yet. Generate one to see context for today&apos;s session.
          </p>
        )}
      </section>

      {homework.length > 0 && (
        <section>
          <p className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
            Recent homework
          </p>
          <ul className="mt-1 space-y-1 text-xs text-[var(--color-ink-2)]">
            {homework.slice(0, 3).map((h) => (
              <li key={h.id} className="flex items-baseline gap-2">
                <Badge tone={homeworkTone(h.status)}>{h.status.toLowerCase()}</Badge>
                <span className="truncate">{h.description}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <TodayIntent clientId={data.clientId} />

      {lastCompletedSessionId && (
        <div className="border-t border-[var(--color-line-soft)] pt-3">
          <Link
            href={`/app/sessions/${lastCompletedSessionId}?tab=copilot`}
            className="text-xs font-medium text-[var(--color-accent)] hover:underline"
          >
            Open last session&apos;s copilot →
          </Link>
        </div>
      )}
    </div>
  );
}

/**
 * SL2 — "Last time you both agreed". Each agreement carries a three-state
 * follow-up (done / partly / not yet) persisted via
 * PATCH /sessions/[id]/agreements/[agreementId]. Optimistic with rollback.
 */
function AgreementsThread({ agreements }: { agreements: SessionAgreementDto[] }) {
  const [rows, setRows] = useState(agreements);
  const [error, setError] = useState<string | null>(null);

  const mark = useCallback(
    async (a: SessionAgreementDto, followUp: AgreementFollowUp): Promise<void> => {
      setError(null);
      const prev = rows;
      setRows((cur) => cur.map((r) => (r.id === a.id ? { ...r, followUp } : r)));
      const res = await fetch(`/api/v1/sessions/${a.sessionId}/agreements/${a.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ followUp }),
      }).catch(() => null);
      if (!res || !res.ok) {
        setRows(prev);
        setError('Could not save the follow-up — try again.');
      }
    },
    [rows],
  );

  return (
    <section>
      <p className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
        Last time you both agreed
      </p>
      <ul className="mt-1.5 space-y-2">
        {rows.map((a) => (
          <li
            key={a.id}
            className="rounded-xl border border-[var(--color-line-soft)] bg-white/40 p-3"
          >
            <p className="text-xs text-[var(--color-ink)]">
              {a.speaker === 'CLIENT' ? <>&ldquo;{a.text}&rdquo;</> : a.text}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(
                [
                  ['DONE', 'Done'],
                  ['PARTLY', 'Partly'],
                  ['NOT_YET', 'Not yet'],
                ] as const
              ).map(([key, label]) => {
                const active = a.followUp === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => void mark(a, key)}
                    className={`rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${
                      active
                        ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] font-medium text-[var(--color-accent)]'
                        : 'border-[var(--color-line)] bg-white text-[var(--color-ink-3)] hover:text-[var(--color-ink)]'
                    }`}
                    aria-pressed={active}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
      {error && <p className="mt-1.5 text-[11px] text-[var(--color-warn)]">{error}</p>}
    </section>
  );
}

/**
 * SL2 — "Today I want to…": the therapist's private one-line intention for
 * the session. Deliberately local (localStorage, per client) — a scratch
 * thought, not a record.
 */
function TodayIntent({ clientId }: { clientId: string }) {
  const storageKey = `prepare-intent-${clientId}`;
  const [value, setValue] = useState('');

  useEffect(() => {
    try {
      setValue(window.localStorage.getItem(storageKey) ?? '');
    } catch {
      // Private mode / storage disabled — the scratch just doesn't persist.
    }
  }, [storageKey]);

  return (
    <section>
      <label
        htmlFor={`intent-${clientId}`}
        className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]"
      >
        Today I want to…
      </label>
      <input
        id={`intent-${clientId}`}
        type="text"
        value={value}
        maxLength={200}
        onChange={(e) => {
          setValue(e.target.value);
          try {
            window.localStorage.setItem(storageKey, e.target.value);
          } catch {
            /* non-fatal */
          }
        }}
        placeholder="e.g. test the Saturday prediction; stay out of advice mode"
        className="mt-1.5 w-full rounded-full border border-[var(--color-line)] bg-white px-4 py-2 text-xs outline-none focus:border-[var(--color-accent)]"
      />
      <p className="mt-1 text-[10px] text-[var(--color-ink-3)]">
        Stays on this device — a scratch thought, not part of the record.
      </p>
    </section>
  );
}

function instrumentLabel(instrumentKey: string): string {
  return instrumentKey === 'PHQ9' ? 'PHQ-9' : instrumentKey === 'GAD7' ? 'GAD-7' : instrumentKey;
}

function verdictChip(verdict: string): string {
  if (verdict === 'reliable_improvement') return 'improving';
  if (verdict === 'deterioration') return 'worsening';
  return 'stable';
}

function homeworkTone(status: string): 'accent' | 'warn' | 'muted' | 'default' {
  if (status === 'COMPLETED') return 'accent';
  if (status === 'SKIPPED' || status === 'EXPIRED') return 'muted';
  if (status === 'IN_PROGRESS') return 'warn';
  return 'default';
}
