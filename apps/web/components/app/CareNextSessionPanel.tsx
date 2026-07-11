'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CareCadence, CareQuestionRank, CareQuestions } from '@cureocity/contracts';
import { Card } from '../ui/Card';
import { PreSessionBriefCard } from './PreSessionBriefCard';

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
 * Sprint JE3 — Next session, zone [5] of the Care Engine page.
 *
 * The recommended cadence (one interval + reason, not the old "5d vs ~7
 * days" contradiction), the questions the therapist should carry into the
 * next visit — ranked by information value, stale ones flagged, each
 * closeable in one tap — and the pre-session brief the next session opens
 * with. The questions are the top few by rank; JE4 adds the full drawer.
 */
export function CareNextSessionPanel({ questions, cadence, clientId }: Props) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? questions.all : questions.top;
  const hasMore = questions.all.length > questions.top.length;

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-accent)]">
          Cadence
        </p>
        <p className="mt-2 text-sm">
          <span className="font-medium text-[var(--color-ink)]">
            Recommend every ~{cadence.recommendedIntervalDays} days
          </span>
          <span className="text-[var(--color-ink-3)]"> · {cadence.nextSessionLabel}</span>
        </p>
        <p className="mt-1 text-xs text-[var(--color-ink-3)]">{cadence.rationale}</p>
      </Card>

      <Card className="p-6">
        <header className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-3)]">
            Carry into the next session
          </p>
          <p className="text-xs text-[var(--color-ink-3)]">
            {questions.openCount} open
            {questions.gateCount > 0 &&
              ` · ${questions.gateCount} ${questions.gateCount === 1 ? 'gates' : 'gate'} the diagnosis`}
            {questions.staleCount > 0 && ` · ${questions.staleCount} stale`}
          </p>
        </header>

        {shown.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--color-ink-3)]">
            Nothing outstanding — the picture is clear enough to proceed.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {shown.map((q) => (
              <QuestionRow key={q.id} clientId={clientId} question={q} />
            ))}
          </ul>
        )}

        {hasMore && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="mt-3 text-xs font-medium text-[var(--color-accent)] hover:underline"
          >
            {showAll
              ? 'Show top few'
              : `Show all ${questions.all.length} open question${questions.all.length === 1 ? '' : 's'}`}
          </button>
        )}
      </Card>

      <PreSessionBriefCard clientId={clientId} />
    </div>
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
