'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PreSessionBrief, PreSessionBriefV1 } from '@cureocity/contracts';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

interface Props {
  clientId: string;
}

interface Response {
  brief: PreSessionBrief;
  source: 'cache' | 'fresh';
}

/**
 * Sprint 17 — Pre-session brief card on the client detail page.
 *
 * Loads on mount via the cached GET endpoint; therapist can
 * regenerate. The card stays tight: context line, last-session
 * recap, today's focus, opening line, watchpoints. Carryover
 * crises render as a warning banner; latest instrument scores
 * surface inline.
 */
export function PreSessionBriefCard({ clientId }: Props) {
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (refresh = false) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (refresh) params.set('refresh', '1');
        const res = await fetch(
          `/api/v1/clients/${clientId}/pre-session-brief${params.toString() ? `?${params.toString()}` : ''}`,
          { cache: 'no-store' },
        );
        const body = (await res.json().catch(() => ({}))) as Response & { error?: string };
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        setData(body);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [clientId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card className="p-6">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-serif text-2xl">Pre-session brief</h2>
          <p className="mt-1 text-sm text-[var(--color-ink-2)]">
            What to focus on today — read this before opening the next session.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data && <Badge tone={data.source === 'fresh' ? 'accent' : 'muted'}>{data.source}</Badge>}
          <Button variant="secondary" onClick={() => void load(true)} disabled={loading}>
            {loading ? 'Generating…' : 'Regenerate'}
          </Button>
        </div>
      </header>

      {loading && !data && (
        <p className="text-sm text-[var(--color-ink-3)]">Preparing the brief…</p>
      )}
      {error && (
        <div className="rounded-2xl border border-[var(--color-warn-border)] bg-[var(--color-warn-bg)] p-4 text-sm text-[var(--color-warn)]">
          {error}
        </div>
      )}
      {data?.brief.body && <BriefBody brief={data.brief.body} />}
    </Card>
  );
}

function BriefBody({ brief }: { brief: PreSessionBriefV1 }) {
  return (
    <div className="space-y-4">
      <p className="font-serif text-lg text-[var(--color-ink)]">{brief.contextLine}</p>

      {brief.carryoverCrisis.length > 0 && (
        <div className="rounded-2xl border-2 border-[var(--color-warn-border)] bg-[var(--color-warn-bg)] p-4 text-sm">
          <strong className="text-[var(--color-warn)]">Open crisis flag(s) — start with a safety check:</strong>
          <ul className="mt-2 list-disc pl-5 text-[var(--color-ink-2)]">
            {brief.carryoverCrisis.map((c, i) => (
              <li key={i}>
                {c.kind.replace(/_/g, ' ')} — severity {c.severity}, last surfaced{' '}
                {new Date(c.lastSeenAt).toLocaleDateString('en-IN', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </li>
            ))}
          </ul>
        </div>
      )}

      {brief.lastSessionRecap.trim().length > 0 && (
        <Section label="Last session">
          <p className="whitespace-pre-line text-sm leading-relaxed text-[var(--color-ink)]">
            {brief.lastSessionRecap}
          </p>
        </Section>
      )}

      <Section label="Today">
        <p className="whitespace-pre-line text-sm leading-relaxed text-[var(--color-ink)]">
          {brief.todaysFocus}
        </p>
      </Section>

      <Section label="Open with">
        <p className="rounded-xl border border-[var(--color-line-soft)] bg-white/30 p-3 text-sm italic text-[var(--color-ink)]">
          {brief.openingLine}
        </p>
      </Section>

      {brief.riskWatchpoints.length > 0 && (
        <Section label="Watch for">
          <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--color-ink)]">
            {brief.riskWatchpoints.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Section>
      )}

      {brief.homeworkStatus && (
        <Section label="Homework from last session">
          <p className="text-sm text-[var(--color-ink)]">
            {brief.homeworkStatus.description}
          </p>
          <p className="mt-1 text-xs text-[var(--color-ink-3)]">
            Outcome: {brief.homeworkStatus.outcome}
            {brief.homeworkStatus.notes ? ` · ${brief.homeworkStatus.notes}` : ''}
          </p>
        </Section>
      )}

      {brief.latestInstruments.length > 0 && (
        <Section label="Latest instrument scores">
          <ul className="flex flex-wrap gap-2 text-xs">
            {brief.latestInstruments.map((i) => (
              <li
                key={`${i.instrumentKey}-${i.administeredAt}`}
                className="rounded-full bg-[var(--color-surface)] px-3 py-1 text-[var(--color-ink-2)]"
              >
                {i.instrumentKey} {i.score} ({i.severity})
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <p className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">{label}</p>
      <div className="mt-1">{children}</div>
    </section>
  );
}
