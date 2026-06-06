'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { InstrumentResponse } from '@cureocity/contracts';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

interface CatalogItem {
  id: string;
  number: number;
  text: { en: string; ml?: string; hi?: string; ta?: string; bn?: string };
}

interface CatalogScale {
  value: number;
  label: { en: string; ml?: string; hi?: string; ta?: string; bn?: string };
}

interface CatalogBand {
  min: number;
  max: number;
  key: string;
  label: { en: string };
}

interface Instrument {
  key: 'PHQ9' | 'GAD7';
  title: { en: string };
  description: { en: string };
  recallWindow: { en: string };
  items: CatalogItem[];
  scale: CatalogScale[];
  severityBands: CatalogBand[];
  riskItemNumber: number | null;
}

interface Props {
  clientId: string;
}

/**
 * Sprint 17 — Instrument runner card on the client detail page.
 *
 * Lists prior administrations (newest first) + lets the therapist
 * pick PHQ-9 / GAD-7 and step through the items inline. On submit
 * the server scores + stores; the trend list re-fetches.
 */
export function InstrumentRunner({ clientId }: Props) {
  const [catalog, setCatalog] = useState<Instrument[]>([]);
  const [history, setHistory] = useState<InstrumentResponse[]>([]);
  const [active, setActive] = useState<Instrument | null>(null);
  const [responses, setResponses] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    const res = await fetch(`/api/v1/clients/${clientId}/instruments`, { cache: 'no-store' });
    if (!res.ok) return;
    const body = (await res.json()) as { items: InstrumentResponse[] };
    setHistory(body.items);
  }, [clientId]);

  useEffect(() => {
    void (async () => {
      const [c, _h] = await Promise.all([
        fetch('/api/v1/instruments', { cache: 'no-store' })
          .then((r) => r.json())
          .catch(() => ({ items: [] as Instrument[] })),
        loadHistory(),
      ]);
      void _h;
      setCatalog((c as { items: Instrument[] }).items);
    })();
  }, [loadHistory]);

  const submit = useCallback(async () => {
    if (!active) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/clients/${clientId}/instruments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instrumentKey: active.key, responses }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        response?: InstrumentResponse;
        risk?: boolean;
        error?: string;
      };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setActive(null);
      setResponses({});
      await loadHistory();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }, [active, clientId, loadHistory, responses]);

  const latestByKey = useMemo(() => {
    const m = new Map<string, InstrumentResponse>();
    for (const h of history) {
      if (!m.has(h.instrumentKey)) m.set(h.instrumentKey, h);
    }
    return m;
  }, [history]);

  if (active) {
    const allAnswered = active.items.every((it) => responses[it.id] !== undefined);
    return (
      <Card className="p-6">
        <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="font-serif text-2xl">{active.title.en}</h2>
            <p className="mt-1 text-sm text-[var(--color-ink-2)]">{active.recallWindow.en}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setActive(null);
              setResponses({});
            }}
            className="text-sm text-[var(--color-ink-2)] hover:text-[var(--color-ink)]"
          >
            ← back
          </button>
        </header>

        <ol className="space-y-5">
          {active.items.map((it) => (
            <li
              key={it.id}
              className="rounded-xl border border-[var(--color-line-soft)] bg-white/30 p-4"
            >
              <p className="text-sm font-medium text-[var(--color-ink)]">
                {it.number}. {it.text.en}
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {active.scale.map((s) => {
                  const selected = responses[it.id] === s.value;
                  return (
                    <button
                      key={s.value}
                      type="button"
                      onClick={() => setResponses((r) => ({ ...r, [it.id]: s.value }))}
                      className={`rounded-xl border px-3 py-2 text-left text-sm transition-colors ${
                        selected
                          ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-ink)]'
                          : 'border-[var(--color-line-soft)] bg-white text-[var(--color-ink-2)] hover:border-[var(--color-ink)]'
                      }`}
                    >
                      <span className="mr-2 font-mono text-xs text-[var(--color-ink-3)]">
                        {s.value}
                      </span>
                      {s.label.en}
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
        </ol>

        {error && (
          <div className="mt-4 rounded-2xl border border-[var(--color-warn-border)] bg-[var(--color-warn-bg)] p-3 text-sm text-[var(--color-warn)]">
            {error}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2 border-t border-[var(--color-line-soft)] pt-4">
          <Button onClick={() => void submit()} disabled={!allAnswered || submitting}>
            {submitting ? 'Scoring…' : 'Score + save'}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-serif text-2xl">Scored instruments</h2>
          <p className="mt-1 text-sm text-[var(--color-ink-2)]">
            Validated screeners (PHQ-9, GAD-7). Administered + scored on this page; the result
            feeds the pre-session brief.
          </p>
        </div>
      </header>

      <div className="flex flex-wrap gap-2">
        {catalog.map((c) => (
          <Button key={c.key} variant="secondary" onClick={() => setActive(c)}>
            Administer {c.key}
          </Button>
        ))}
      </div>

      {history.length === 0 ? (
        <p className="mt-5 text-sm text-[var(--color-ink-3)]">
          No instruments administered yet.
        </p>
      ) : (
        <>
          <h3 className="mt-6 text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
            History
          </h3>
          <ul className="mt-2 divide-y divide-[var(--color-line-soft)] border-y border-[var(--color-line-soft)]">
            {history.map((h) => {
              const latest = latestByKey.get(h.instrumentKey)?.id === h.id;
              return (
                <li key={h.id} className="flex flex-wrap items-baseline justify-between gap-2 px-1 py-3 text-sm">
                  <div>
                    <span className="font-mono text-xs text-[var(--color-ink-3)]">
                      {h.instrumentKey}
                    </span>
                    <span className="ml-2">
                      score {h.score} ·{' '}
                      <Badge tone={severityTone(h.severity)}>
                        {h.severity.replace(/_/g, ' ')}
                      </Badge>
                    </span>
                  </div>
                  <span className="text-xs text-[var(--color-ink-3)]">
                    {new Date(h.administeredAt).toLocaleString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                    {latest && (
                      <Badge tone="accent" className="ml-2">
                        latest
                      </Badge>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Card>
  );
}

function severityTone(severity: string): 'accent' | 'warn' | 'muted' | 'default' {
  switch (severity) {
    case 'minimal':
    case 'mild':
      return 'accent';
    case 'moderate':
      return 'muted';
    case 'moderately_severe':
    case 'severe':
      return 'warn';
    default:
      return 'default';
  }
}
