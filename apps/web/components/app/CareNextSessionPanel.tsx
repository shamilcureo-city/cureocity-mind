'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type {
  CareCadence,
  CareQuestionRank,
  CareQuestions,
  PreSessionBrief,
  PreSessionBriefV1,
} from '@cureocity/contracts';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

interface Props {
  questions: CareQuestions;
  cadence: CareCadence;
  clientId: string;
}

const RANK_META: Record<CareQuestionRank, { label: string; chip: string }> = {
  safety: { label: 'Safety', chip: 'bg-[#a03b34] text-white' },
  differentiate: {
    label: 'Differentiator',
    chip: 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]',
  },
  confirm: { label: 'Confirm dx', chip: 'bg-[#f6efdc] text-[#8a7434]' },
  context: {
    label: 'Context',
    chip: 'bg-white text-[var(--color-ink-3)] border border-[var(--color-line)]',
  },
};

/**
 * Sprint JE6 — "Next session": ONE card for everything about the next visit.
 *
 * Replaces three stacked cards (cadence, carried questions, the LLM
 * pre-session brief) that overlapped each other. Structure:
 *   1. The cadence line — when, and why that interval.
 *   2. The carried questions — the deterministic truth from the engine,
 *      ranked, stale-flagged, closeable in one tap, full list on demand.
 *   3. "Opens with" — the LLM brief's UNIQUE fields only (context line,
 *      last-session recap, today's focus, opening line, watchpoints,
 *      homework). Its crisis banner and instrument scores are deliberately
 *      NOT rendered — safety lives on the board, scores in "Is it working?".
 */
export function CareNextSessionPanel({ questions, cadence, clientId }: Props) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? questions.all : questions.top;
  const hasMore = questions.all.length > questions.top.length;

  return (
    <Card className="p-6">
      <header>
        <h2 className="font-serif text-2xl">Next session</h2>
        <p className="mt-1 text-sm">
          <span className="font-medium text-[var(--color-ink)]">
            {capitalise(cadence.nextSessionLabel)}
          </span>
          <span className="text-[var(--color-ink-3)]">
            {' '}
            · every ~{cadence.recommendedIntervalDays} days
          </span>
        </p>
        <p className="mt-0.5 text-xs text-[var(--color-ink-3)]">{cadence.rationale}</p>
      </header>

      {/* Carried questions — the engine's ranked list. */}
      <div className="mt-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-3)]">
            Carry into the session
          </p>
          <p className="text-xs text-[var(--color-ink-3)]">
            {questions.openCount} open
            {questions.gateCount > 0 &&
              ` · ${questions.gateCount} ${questions.gateCount === 1 ? 'gates' : 'gate'} the diagnosis`}
            {questions.staleCount > 0 && ` · ${questions.staleCount} stale`}
          </p>
        </div>

        {shown.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--color-ink-3)]">
            Nothing outstanding — the picture is clear enough to proceed.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {shown.map((q) => (
              <QuestionRow key={q.id} clientId={clientId} question={q} />
            ))}
          </ul>
        )}

        {hasMore && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="mt-2 text-xs font-medium text-[var(--color-accent)] hover:underline"
          >
            {showAll
              ? 'Show top few'
              : `Show all ${questions.all.length} open question${questions.all.length === 1 ? '' : 's'}`}
          </button>
        )}
      </div>

      {/* The AI brief — only the fields nothing else on the page owns. */}
      <BriefSection clientId={clientId} />
    </Card>
  );
}

function QuestionRow({
  clientId,
  question,
}: {
  clientId: string;
  question: CareQuestions['top'][number];
}) {
  const router = useRouter();
  const [closing, setClosing] = useState(false);
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);
  const meta = RANK_META[question.rank];

  async function close(): Promise<void> {
    setClosing(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/v1/clients/${clientId}/assessment-items/${question.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'CLOSED' }),
      });
      if (res.ok) {
        setDone(true);
        router.refresh();
      } else {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    } finally {
      setClosing(false);
    }
  }

  if (done) return null;

  return (
    <li className="rounded-xl border border-[var(--color-line-soft)] bg-white/40 p-3">
      <div className="flex items-start gap-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${meta.chip}`}
            >
              {meta.label}
            </span>
            {question.stale && (
              <span className="inline-flex items-center rounded-full bg-[var(--color-warn-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-warn)]">
                Stale
              </span>
            )}
            {question.icd11Code && (
              <span className="font-mono text-[10px] text-[var(--color-ink-3)]">
                {question.icd11Code}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm font-medium text-[var(--color-ink)]">{question.question}</p>
          <p className="mt-0.5 text-xs text-[var(--color-ink-3)]">{question.rationale}</p>
          {failed && (
            <p className="mt-1 text-xs text-[var(--color-warn)]">
              Couldn&rsquo;t close — it may already be resolved. Try again.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void close()}
          disabled={closing}
          className="shrink-0 rounded-full border border-[var(--color-line)] bg-white px-3 py-1 text-xs font-medium text-[var(--color-ink-2)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] disabled:opacity-50"
        >
          {closing ? 'Closing…' : failed ? 'Retry' : 'Close'}
        </button>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// The pre-session brief (Pass 5), rendered as a subsection with only the
// fields no other zone owns. Loads on mount from the cached GET endpoint.
// ---------------------------------------------------------------------------

interface BriefResponse {
  brief: PreSessionBrief;
  source: 'cache' | 'fresh';
}

function BriefSection({ clientId }: { clientId: string }) {
  const [data, setData] = useState<BriefResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (refresh = false) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/v1/clients/${clientId}/pre-session-brief${refresh ? '?refresh=1' : ''}`,
          { cache: 'no-store' },
        );
        const body = (await res.json().catch(() => ({}))) as BriefResponse & { error?: string };
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

  const brief = data?.brief.body ?? null;

  return (
    <div className="mt-6 border-t border-[var(--color-line-soft)] pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-3)]">
          Opens with · AI brief
        </p>
        <div className="flex items-center gap-2">
          {data && <Badge tone={data.source === 'fresh' ? 'accent' : 'muted'}>{data.source}</Badge>}
          <Button variant="secondary" onClick={() => void load(true)} disabled={loading}>
            {loading ? 'Generating…' : 'Regenerate'}
          </Button>
        </div>
      </div>

      {loading && !data && (
        <p className="mt-2 text-sm text-[var(--color-ink-3)]">Preparing the brief…</p>
      )}
      {error && (
        <p className="mt-2 rounded-xl border border-[var(--color-warn-border)] bg-[var(--color-warn-bg)] p-3 text-sm text-[var(--color-warn)]">
          {error}
        </p>
      )}
      {brief && <BriefBody brief={brief} />}
    </div>
  );
}

function BriefBody({ brief }: { brief: PreSessionBriefV1 }) {
  return (
    <div className="mt-3 space-y-3">
      <p className="font-serif text-lg text-[var(--color-ink)]">{brief.contextLine}</p>

      {brief.lastSessionRecap.trim().length > 0 && (
        <BriefField label="Last session">
          <p className="whitespace-pre-line text-sm leading-relaxed">{brief.lastSessionRecap}</p>
        </BriefField>
      )}

      <BriefField label="Today">
        <p className="whitespace-pre-line text-sm leading-relaxed">{brief.todaysFocus}</p>
      </BriefField>

      <BriefField label="Open with">
        <p className="rounded-xl border border-[var(--color-line-soft)] bg-white/30 p-3 text-sm italic">
          {brief.openingLine}
        </p>
      </BriefField>

      {brief.riskWatchpoints.length > 0 && (
        <BriefField label="Watch for">
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {brief.riskWatchpoints.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </BriefField>
      )}

      {brief.homeworkStatus && (
        <BriefField label="Homework from last session">
          <p className="text-sm">{brief.homeworkStatus.description}</p>
          <p className="mt-1 text-xs text-[var(--color-ink-3)]">
            Outcome: {brief.homeworkStatus.outcome}
            {brief.homeworkStatus.notes ? ` · ${brief.homeworkStatus.notes}` : ''}
          </p>
        </BriefField>
      )}
    </div>
  );
}

function BriefField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <p className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">{label}</p>
      <div className="mt-1">{children}</div>
    </section>
  );
}

function capitalise(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}
