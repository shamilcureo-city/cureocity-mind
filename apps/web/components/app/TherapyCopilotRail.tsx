'use client';

import { useCallback, useEffect, useRef } from 'react';
import type {
  TherapyAskNextItem,
  TherapyReasoningV1,
  TherapyRiskWatchItem,
  TherapyThreadItem,
} from '@cureocity/contracts';
import { Card } from '../ui/Card';
import { cueReviewKey, type MindCueReview } from '@/lib/mind-cue-review';
import { liveCopilotVisibleCounts } from '@/lib/mind-guidance';
import {
  disclosedCopilotSuggestions,
  type DisclosedCopilotSuggestion,
} from '@/lib/therapy-copilot-disclosure';

/**
 * Sprint TS5 → TS5.4 — the live therapy copilot rail.
 *
 * Renders the copilot snapshot (seeded session plan first, then the gateway's
 * PASS_12 stream): a risk watch, the SESSION PLAN (the questions the
 * therapist carried in + the copilot's ranked open assessment questions —
 * visible from second zero, before any AI pass runs), live "ask next" cues
 * heard in the room, threads the client raised but didn't explore, and a
 * session-pacing clock. Every card is passive — one tap to mark it
 * asked/explored or to dismiss it, both of which stop the gateway
 * re-suggesting it and write an audit row. An "AI" tag on the header keeps it
 * visually distinct from what the therapist has decided, doctor-style.
 */
export function TherapyCopilotRail({
  reasoning,
  onResolve,
  onShown,
  mode = 'guided',
  guideActive = false,
  reviewedCues = [],
  cueLabels = {},
  pendingId = null,
  reviewBlocked = false,
  reviewError = null,
  onUndo,
  onRetry,
  onReload,
}: {
  reasoning: TherapyReasoningV1;
  mode?: 'quiet' | 'guided';
  guideActive?: boolean;
  reviewedCues?: MindCueReview[];
  cueLabels?: Record<string, string>;
  pendingId?: string | null;
  reviewBlocked?: boolean;
  reviewError?: string | null;
  onUndo?: (record: MindCueReview) => void;
  onRetry?: () => void;
  onReload?: () => void;
  onShown?: (items: DisclosedCopilotSuggestion[]) => void;
  onResolve: (
    id: string,
    kind: 'ASK_NEXT' | 'RED_FLAG' | 'GAP',
    event: 'acted' | 'dismissed',
    label?: string,
  ) => void;
}) {
  const { riskWatch, askNext, threads, arc } = reasoning;
  // Prepared questions and live suggestions retain their source, but only one
  // ordinary item leads the session. The rest is available on request.
  const planned = askNext.filter((a) => a.source === 'CARRIED');
  const live = askNext.filter((a) => a.source !== 'CARRIED');
  const nothing = riskWatch.length === 0 && askNext.length === 0 && threads.length === 0;
  const visible = liveCopilotVisibleCounts(
    mode,
    planned.length,
    live.length,
    threads.length,
    guideActive,
  );
  const remainingPlanned = planned.slice(visible.planned);
  const remainingLive = live.slice(visible.live);
  const remainingThreads = threads.slice(visible.threads);
  const remainingCount = remainingPlanned.length + remainingLive.length + remainingThreads.length;
  const supportDetailsRef = useRef<HTMLDetailsElement>(null);
  const reportShown = useCallback(() => {
    if (!onShown) return;
    // Read native disclosure state, so updates while open and removed/remounted
    // details use what is actually disclosed, not stale expansion state.
    const items = disclosedCopilotSuggestions(
      reasoning,
      mode,
      {
        live: supportDetailsRef.current?.open ?? false,
        threads: supportDetailsRef.current?.open ?? false,
      },
      guideActive,
    );
    if (items.length > 0) onShown(items);
  }, [reasoning, mode, onShown, guideActive]);
  useEffect(reportShown, [reportShown]);

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center gap-2 px-4 pb-2 pt-3.5">
        <h2 className="text-base font-semibold text-[var(--color-ink)]">Session support</h2>
        <span className="rounded-full border border-[#e7d9b0] bg-[#f6efdc] px-2 py-px text-[10px] font-bold tracking-[0.08em] text-[#8a7434]">
          AI
        </span>
        <span className="text-xs text-[var(--color-ink-2)]">You decide what to use.</span>
      </div>

      {mode === 'guided' && guideActive && (
        <p className="px-4 pb-3 text-sm text-[var(--color-ink-2)]">
          Your selected guide is in focus. Open other questions only when they are useful.
        </p>
      )}

      {reviewError && (
        <div
          role="alert"
          className="mx-4 mb-3 rounded-xl border border-[var(--color-warn)] p-3 text-sm"
        >
          <p>{reviewError}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <MiniAct onClick={() => onRetry?.()} disabled={pendingId !== null}>
              Retry last action
            </MiniAct>
            <MiniAct quiet onClick={() => onReload?.()} disabled={pendingId !== null}>
              Reload review history
            </MiniAct>
          </div>
        </div>
      )}
      {pendingId && (
        <p role="status" className="px-4 pb-3 text-sm">
          Saving your review…
        </p>
      )}
      {reviewBlocked && !reviewError && !pendingId && (
        <p role="status" className="px-4 pb-3 text-sm">
          Loading review history… Safety cues stay visible.
        </p>
      )}

      <fieldset disabled={reviewBlocked || pendingId !== null} className="min-w-0">
        {riskWatch.length > 0 && (
          <RailSection title="Safety concerns to review" risk>
            {riskWatch.map((r) => (
              <RiskCard key={r.id} item={r} onResolve={onResolve} />
            ))}
          </RailSection>
        )}

        {mode === 'guided' && visible.planned > 0 && (
          <RailSection title="A question you prepared">
            {planned.slice(0, visible.planned).map((a) => (
              <AskCard key={a.id} item={a} onResolve={onResolve} />
            ))}
          </RailSection>
        )}

        {mode === 'guided' && visible.live > 0 && (
          <RailSection title="A question to consider now">
            {live.slice(0, visible.live).map((a) => (
              <AskCard key={a.id} item={a} onResolve={onResolve} />
            ))}
          </RailSection>
        )}

        {mode === 'guided' && visible.threads > 0 && (
          <RailSection title="A topic to return to">
            {threads.slice(0, visible.threads).map((t) => (
              <ThreadCard key={t.id} item={t} onResolve={onResolve} />
            ))}
          </RailSection>
        )}

        {mode === 'guided' && remainingCount > 0 && (
          <details
            ref={supportDetailsRef}
            onToggle={reportShown}
            className="border-t border-[var(--color-line-soft)]"
          >
            <summary className="min-h-11 cursor-pointer px-4 py-3 text-sm font-medium text-[var(--color-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-accent)]">
              More session support ({remainingCount})
            </summary>
            <p className="px-4 pb-3 text-sm text-[var(--color-ink-2)]">
              Choose only what helps this conversation. These are options, not a checklist.
            </p>
            {remainingPlanned.length > 0 && (
              <RailSection title="Prepared questions">
                {remainingPlanned.map((a) => (
                  <AskCard key={a.id} item={a} onResolve={onResolve} />
                ))}
              </RailSection>
            )}
            {remainingLive.length > 0 && (
              <RailSection title="Questions from this conversation">
                {remainingLive.map((a) => (
                  <AskCard key={a.id} item={a} onResolve={onResolve} />
                ))}
              </RailSection>
            )}
            {remainingThreads.length > 0 && (
              <RailSection title="Topics to return to">
                {remainingThreads.map((t) => (
                  <ThreadCard key={t.id} item={t} onResolve={onResolve} />
                ))}
              </RailSection>
            )}
          </details>
        )}
      </fieldset>

      {reviewedCues.some(
        (record) =>
          record.state === 'reopened' &&
          record.kind === 'RED_FLAG' &&
          !riskWatch.some((risk) => risk.id === record.id),
      ) && (
        <p
          role="status"
          className="mx-4 mb-3 rounded-xl border border-[var(--color-warn)] p-3 text-sm"
        >
          A previous safety cue was reopened for your review. It is not in the current live
          suggestions. Review the history and clinical record; no assessment has been recorded by
          this action.
        </p>
      )}
      {reviewedCues.length > 0 && (
        <details className="border-t border-[var(--color-line-soft)] px-4 py-3">
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]">
            Review history ({reviewedCues.length})
          </summary>
          <p className="mb-3 text-sm text-[var(--color-ink-2)]">
            These are interface choices, not documented assessments. Undo asks you to review the cue
            again; it does not regenerate an old suggestion.
          </p>
          <p className="mb-3 text-sm text-[var(--color-ink-2)]">
            Descriptions are from an earlier display and may differ from the current cue. New
            content or evidence stays visible for review.
          </p>
          <ul className="space-y-3">
            {[...reviewedCues].reverse().map((record) => (
              <li
                key={cueReviewKey(record.kind, record.id)}
                className="rounded-xl border border-[var(--color-line-soft)] p-3 text-sm"
              >
                <p className="font-medium">
                  {cueLabels[cueReviewKey(record.kind, record.id)] ??
                    cueLabels[record.id] ??
                    (record.kind === 'RED_FLAG' ? 'Previous safety cue' : 'Previous session cue')}
                </p>
                <p className="mt-1 text-[var(--color-ink-2)]">
                  {record.state === 'reviewed'
                    ? 'Marked reviewed'
                    : record.state === 'dismissed'
                      ? 'Hidden as not relevant'
                      : 'Reopened for review'}
                  {' · '}
                  {new Date(record.updatedAt).toLocaleString('en-IN', {
                    timeZone: 'Asia/Kolkata',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
                {record.state !== 'reopened' && onUndo && (
                  <MiniAct
                    disabled={reviewBlocked || pendingId !== null}
                    onClick={() => onUndo(record)}
                  >
                    Undo · review again
                  </MiniAct>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {mode === 'quiet' && (
        <p className="px-4 pb-4 text-xs leading-relaxed text-[var(--color-ink-2)]">
          Quiet mode keeps ordinary suggestions out of the way. Safety concerns remain visible.
          Switch to Guided when you want questions and context.
        </p>
      )}
      {nothing && mode === 'guided' && (
        <div className="px-4 pb-3 text-[13px] text-[var(--color-ink-3)]">
          No live suggestions yet. Continue your own assessment and conversation.
        </div>
      )}

      {arc && mode === 'guided' && (
        <details className="border-t border-[var(--color-line-soft)] px-4 py-3">
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-[var(--color-ink-2)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]">
            Session pacing · {arc.elapsedMin} of {arc.plannedMin} min
          </summary>
          <p className="mt-1 text-[12.5px] capitalize text-[var(--color-ink-2)]">
            {arc.phase} phase · {arc.elapsedMin} of {arc.plannedMin} min
          </p>
          <div className="my-2 h-1 overflow-hidden rounded-full bg-[var(--color-line-soft)]">
            <div
              className={`h-full ${arc.phase === 'overrun' ? 'bg-[var(--color-warn)]' : 'bg-[var(--color-accent)] opacity-70'}`}
              style={{
                width: `${Math.min(100, Math.round((arc.elapsedMin / arc.plannedMin) * 100))}%`,
              }}
            />
          </div>
          <p className="text-[12px] text-[var(--color-ink-3)]">{arc.suggestion}</p>
        </details>
      )}
    </Card>
  );
}

function RailSection({
  title,
  risk = false,
  children,
}: {
  title: string;
  risk?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="border-t border-[var(--color-line-soft)] px-4 py-3">
      <h3
        className={`mb-2 text-sm font-semibold ${
          risk ? 'text-[var(--color-warn)]' : 'text-[var(--color-ink-2)]'
        }`}
      >
        {title}
      </h3>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

const SEVERITY_TONE: Record<string, string> = {
  critical: 'border-red-300 bg-red-50',
  high: 'border-red-300 bg-red-50',
  medium: 'border-amber-300 bg-amber-50',
  low: 'border-[var(--color-line-soft)] bg-white/40',
};

function RiskCard({
  item,
  onResolve,
}: {
  item: TherapyRiskWatchItem;
  onResolve: (
    id: string,
    kind: 'ASK_NEXT' | 'RED_FLAG' | 'GAP',
    event: 'acted' | 'dismissed',
    label?: string,
  ) => void;
}) {
  return (
    <div
      className={`rounded-xl border p-3 text-sm ${SEVERITY_TONE[item.severity] ?? SEVERITY_TONE['low']}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <b className="text-[var(--color-ink)]">{item.label}</b>
        <span className="text-xs font-semibold text-[var(--color-ink-2)]">
          {item.source === 'CARRIED_RISK' ? 'carried' : item.severity}
        </span>
      </div>
      <p className="mt-0.5 text-[var(--color-ink-2)]">{item.why}</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <MiniAct onClick={() => onResolve(item.id, 'RED_FLAG', 'acted', item.label)}>
          Mark cue reviewed
        </MiniAct>
        <MiniAct quiet onClick={() => onResolve(item.id, 'RED_FLAG', 'dismissed', item.label)}>
          Not relevant
        </MiniAct>
      </div>
      <p className="mt-2 text-xs text-[var(--color-ink-2)]">
        Reviewing or hiding this AI cue does not document a safety assessment.
      </p>
    </div>
  );
}

function AskCard({
  item,
  onResolve,
}: {
  item: TherapyAskNextItem;
  onResolve: (
    id: string,
    kind: 'ASK_NEXT' | 'RED_FLAG' | 'GAP',
    event: 'acted' | 'dismissed',
    label?: string,
  ) => void;
}) {
  return (
    <div className="rounded-xl border border-[var(--color-line-soft)] p-3 text-sm leading-relaxed">
      <p className="max-w-prose font-semibold text-[var(--color-ink)]">{item.question}</p>
      <p className="mt-0.5 text-[var(--color-ink-3)]">{item.why}</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <MiniAct onClick={() => onResolve(item.id, 'ASK_NEXT', 'acted', item.question)}>
          Mark asked
        </MiniAct>
        <MiniAct quiet onClick={() => onResolve(item.id, 'ASK_NEXT', 'dismissed', item.question)}>
          Skip question
        </MiniAct>
      </div>
    </div>
  );
}

function ThreadCard({
  item,
  onResolve,
}: {
  item: TherapyThreadItem;
  onResolve: (
    id: string,
    kind: 'ASK_NEXT' | 'RED_FLAG' | 'GAP',
    event: 'acted' | 'dismissed',
    label?: string,
  ) => void;
}) {
  return (
    <div className="rounded-xl border border-[var(--color-line-soft)] p-3 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <b className="text-[var(--color-ink)]">{item.topic}</b>
        {item.mentions > 1 && (
          <span className="text-[10px] font-medium text-[var(--color-ink-3)]">
            ×{item.mentions}
          </span>
        )}
      </div>
      <p className="mt-0.5 text-[var(--color-ink-3)]">{item.note}</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <MiniAct onClick={() => onResolve(item.id, 'GAP', 'acted', item.topic)}>
          Mark explored
        </MiniAct>
        <MiniAct quiet onClick={() => onResolve(item.id, 'GAP', 'dismissed', item.topic)}>
          Skip topic
        </MiniAct>
      </div>
    </div>
  );
}

function MiniAct({
  children,
  onClick,
  quiet = false,
  disabled = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  quiet?: boolean;
  disabled?: boolean;
}) {
  return (
    // Large enough to use while attention stays primarily with the client.
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`min-h-11 rounded-full px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50 ${
        quiet
          ? 'text-[var(--color-ink-3)] hover:text-[var(--color-ink)]'
          : 'border border-[var(--color-line)] bg-white text-[var(--color-accent)] hover:border-[var(--color-accent)]'
      }`}
    >
      {children}
    </button>
  );
}
