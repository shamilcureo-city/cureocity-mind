'use client';

import { useCallback, useEffect, useState } from 'react';
import type { CaseConsultV1 } from '@cureocity/contracts';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

/**
 * Sprint 52 — Case Consult panel.
 *
 * The "I'm stuck — second opinion" surface. Fetches the cached consult
 * on mount; a Generate button runs Pass 8 synchronously. Cached per
 * (clientId, lastSessionId), so a fresh COMPLETED session invalidates
 * — the cache key flips and the next GET returns null until the
 * therapist regenerates.
 *
 * Therapist-facing only. Never shared with patients (no PatientShare
 * artefact type for this output).
 */

interface Props {
  clientId: string;
}

interface Response {
  consult: CaseConsultV1 | null;
  generatedAt: string | null;
}

export function CaseConsultPanel({ clientId }: Props) {
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/clients/${clientId}/case-consult`, { cache: 'no-store' });
      const body = (await res.json().catch(() => ({}))) as Response & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setData(body);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/clients/${clientId}/case-consult`, {
        method: 'POST',
        cache: 'no-store',
      });
      const body = (await res.json().catch(() => ({}))) as Response & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setData(body);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <Card className="p-6">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-serif text-2xl">Case consult</h2>
          <p className="mt-1 text-sm text-[var(--color-ink-2)]">
            A structured second opinion when you&rsquo;re stuck — what&rsquo;s been tried, what the
            data shows, options to consider, and questions to bring to supervision. Therapist-facing
            only.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data?.generatedAt && (
            <span className="text-xs text-[var(--color-ink-3)]">
              {formatRelative(data.generatedAt)}
            </span>
          )}
          <Button onClick={generate} disabled={generating || loading} variant="secondary">
            {generating ? 'Generating…' : data?.consult ? 'Refresh' : 'Generate'}
          </Button>
        </div>
      </header>

      {loading && !data && <p className="text-sm text-[var(--color-ink-3)]">Loading…</p>}
      {error && (
        <p className="rounded-xl border border-[var(--color-warn-border)] bg-[var(--color-warn-bg)] p-3 text-sm text-[var(--color-warn)]">
          {error}
        </p>
      )}
      {data && !data.consult && !loading && !generating && !error && (
        <p className="text-sm text-[var(--color-ink-3)]">
          No consult yet for this client&rsquo;s most recent session. Tap Generate to draft one.
        </p>
      )}
      {data?.consult && <ConsultBody consult={data.consult} />}
    </Card>
  );
}

function ConsultBody({ consult }: { consult: CaseConsultV1 }) {
  return (
    <div className="space-y-5 text-sm">
      <section>
        <p className="text-[var(--color-ink)]">{consult.situationSummary}</p>
      </section>

      {consult.whatTheDataShows.length > 0 && (
        <Section label="What the data shows">
          <ul className="list-disc space-y-1 pl-5 text-[var(--color-ink-2)]">
            {consult.whatTheDataShows.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </Section>
      )}

      {consult.whatsBeenTried.length > 0 && (
        <Section label="What's been tried">
          <ul className="space-y-2">
            {consult.whatsBeenTried.map((t, i) => (
              <li key={i} className="rounded-xl border border-[var(--color-line-soft)] bg-white/40 p-3">
                <p className="font-medium text-[var(--color-ink)]">
                  {t.approach}{' '}
                  <span className="text-xs text-[var(--color-ink-3)]">· {t.sessions} sessions</span>
                </p>
                <p className="mt-1 text-xs text-[var(--color-ink-2)]">{t.observedEffect}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {consult.differentialConsiderations.length > 0 && (
        <Section label="Differential considerations">
          <ul className="space-y-2">
            {consult.differentialConsiderations.map((d, i) => (
              <li key={i} className="rounded-xl border border-[var(--color-line-soft)] bg-white/40 p-3">
                <p className="font-medium text-[var(--color-ink)]">
                  {d.consideration}
                  {d.icd11Code && <Badge tone="muted">{d.icd11Code}</Badge>}
                </p>
                <p className="mt-1 text-xs">
                  <strong className="text-[var(--color-ink-2)]">For:</strong>{' '}
                  <span className="text-[var(--color-ink-2)]">{d.evidenceFor}</span>
                </p>
                <p className="mt-0.5 text-xs">
                  <strong className="text-[var(--color-ink-2)]">Against:</strong>{' '}
                  <span className="text-[var(--color-ink-2)]">{d.evidenceAgainst}</span>
                </p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {consult.evidenceBasedOptions.length > 0 && (
        <Section label="Options to consider">
          <ul className="space-y-2">
            {consult.evidenceBasedOptions.map((o, i) => (
              <li key={i} className="rounded-xl border border-[var(--color-line-soft)] bg-white/40 p-3">
                <p className="font-medium text-[var(--color-ink)]">{o.option}</p>
                <p className="mt-1 text-xs text-[var(--color-ink-2)]">{o.rationale}</p>
                {o.indiaContextNote && (
                  <p className="mt-1 text-xs italic text-[var(--color-ink-3)]">
                    {o.indiaContextNote}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {consult.questionsForSupervision.length > 0 && (
        <Section label="For supervision">
          <ul className="list-disc space-y-1 pl-5 text-[var(--color-ink-2)]">
            {consult.questionsForSupervision.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </Section>
      )}

      {consult.indiaContextCautions.length > 0 && (
        <Section label="India context">
          <ul className="list-disc space-y-1 pl-5 text-[var(--color-ink-2)]">
            {consult.indiaContextCautions.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </Section>
      )}

      <p className="border-t border-[var(--color-line-soft)] pt-3 text-xs italic text-[var(--color-ink-3)]">
        {consult.disclaimer}
      </p>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <p className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">{label}</p>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const minute = 60 * 1000;
  if (diff < minute) return 'just now';
  if (diff < 60 * minute) return `${Math.round(diff / minute)}m ago`;
  if (diff < 24 * 60 * minute) return `${Math.round(diff / (60 * minute))}h ago`;
  return `${Math.round(diff / (24 * 60 * minute))}d ago`;
}
