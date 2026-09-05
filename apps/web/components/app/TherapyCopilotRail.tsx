'use client';

import { useCallback, useEffect, useRef } from 'react';
import type {
  TherapyAskNextItem,
  TherapyReasoningV1,
  TherapyRiskWatchItem,
  TherapyThreadItem,
} from '@cureocity/contracts';
import { Card } from '../ui/Card';
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
}: {
  reasoning: TherapyReasoningV1;
  mode?: 'quiet' | 'guided';
  onShown?: (items: DisclosedCopilotSuggestion[]) => void;
  onResolve: (
    id: string,
    kind: 'ASK_NEXT' | 'RED_FLAG' | 'GAP',
    event: 'acted' | 'dismissed',
    label?: string,
  ) => void;
}) {
  const { riskWatch, askNext, threads, arc } = reasoning;
  // The plan (carried in) and the live cues (heard in the room) are different
  // altitudes — separate sections, not chips on a mixed list.
  const planned = askNext.filter((a) => a.source === 'CARRIED');
  const live = askNext.filter((a) => a.source !== 'CARRIED');
  const nothing = riskWatch.length === 0 && askNext.length === 0 && threads.length === 0;
  const visible = liveCopilotVisibleCounts(mode, planned.length, live.length, threads.length);
  const liveDetailsRef = useRef<HTMLDetailsElement>(null);
  const threadDetailsRef = useRef<HTMLDetailsElement>(null);
  const reportShown = useCallback(() => {
    if (!onShown) return;
    // Read native disclosure state, so updates while open and removed/remounted
    // details use what is actually disclosed, not stale expansion state.
    const items = disclosedCopilotSuggestions(reasoning, mode, {
      live: liveDetailsRef.current?.open ?? false,
      threads: threadDetailsRef.current?.open ?? false,
    });
    if (items.length > 0) onShown(items);
  }, [reasoning, mode, onShown]);
  useEffect(reportShown, [reportShown]);

  return (
    <Card className="overflow-hidden border-t-[3px] border-t-[#d9c9a3] p-0">
      <div className="flex items-center gap-2 px-4 pb-2 pt-3.5">
        <h2 className="text-sm font-semibold text-[var(--color-ink)]">Session companion</h2>
        <span className="rounded-full border border-[#e7d9b0] bg-[#f6efdc] px-2 py-px text-[10px] font-bold tracking-[0.08em] text-[#8a7434]">
          AI
        </span>
        <span className="ml-auto text-[11px] text-[var(--color-ink-3)]">
          suggestions — you decide
        </span>
      </div>

      {riskWatch.length > 0 && (
        <RailSection title="Risk watch" risk>
          {riskWatch.map((r) => (
            <RiskCard key={r.id} item={r} onResolve={onResolve} />
          ))}
        </RailSection>
      )}

      {mode === 'guided' && planned.length > 0 && (
        <RailSection title={`Session plan · ${planned.length} to ask`}>
          {planned.slice(0, visible.planned).map((a) => (
            <AskCard key={a.id} item={a} onResolve={onResolve} />
          ))}
          {planned.length > visible.planned && (
            <details className="pt-2 text-xs">
              <summary className="cursor-pointer text-[var(--color-accent)]">
                {planned.length - visible.planned} more prepared questions
              </summary>
              <div className="mt-3 space-y-2">
                {planned.slice(visible.planned).map((a) => (
                  <AskCard key={a.id} item={a} onResolve={onResolve} />
                ))}
              </div>
            </details>
          )}
        </RailSection>
      )}

      {mode === 'guided' && live.length > 0 && (
        <RailSection title="Heard live — ask next">
          {live.slice(0, visible.live).map((a) => (
            <AskCard key={a.id} item={a} onResolve={onResolve} />
          ))}
          {live.length > visible.live && (
            <details ref={liveDetailsRef} onToggle={reportShown} className="pt-2 text-xs">
              <summary className="cursor-pointer text-[var(--color-accent)]">
                {live.length - visible.live} more live suggestions
              </summary>
              <div className="mt-3 space-y-2">
                {live.slice(visible.live).map((a) => (
                  <AskCard key={a.id} item={a} onResolve={onResolve} />
                ))}
              </div>
            </details>
          )}
        </RailSection>
      )}

      {mode === 'guided' && threads.length > 0 && (
        <RailSection title="Threads not followed">
          {threads.slice(0, visible.threads).map((t) => (
            <ThreadCard key={t.id} item={t} onResolve={onResolve} />
          ))}
          {threads.length > visible.threads && (
            <details ref={threadDetailsRef} onToggle={reportShown} className="pt-2 text-xs">
              <summary className="cursor-pointer text-[var(--color-accent)]">
                {threads.length - visible.threads} more threads
              </summary>
              <div className="mt-3 space-y-2">
                {threads.slice(visible.threads).map((t) => (
                  <ThreadCard key={t.id} item={t} onResolve={onResolve} />
                ))}
              </div>
            </details>
          )}
        </RailSection>
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

      {arc && (
        <div className="border-t border-[var(--color-line-soft)] px-4 py-3">
          <p className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-[var(--color-ink-3)]">
            Session arc
          </p>
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
        </div>
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
        className={`mb-2 text-[10.5px] font-bold uppercase tracking-[0.1em] ${
          risk ? 'text-[var(--color-risk,#a03b34)]' : 'text-[var(--color-ink-3)]'
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
      className={`rounded-xl border p-2.5 text-[12.5px] ${SEVERITY_TONE[item.severity] ?? SEVERITY_TONE['low']}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <b className="text-[var(--color-ink)]">{item.label}</b>
        <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-ink-3)]">
          {item.source === 'CARRIED_RISK' ? 'carried' : item.severity}
        </span>
      </div>
      <p className="mt-0.5 text-[var(--color-ink-2)]">{item.why}</p>
      <div className="mt-1.5 flex gap-1.5">
        <MiniAct onClick={() => onResolve(item.id, 'RED_FLAG', 'acted', item.label)}>
          Assessed ✓
        </MiniAct>
        <MiniAct quiet onClick={() => onResolve(item.id, 'RED_FLAG', 'dismissed', item.label)}>
          Not relevant
        </MiniAct>
      </div>
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
    <div className="rounded-xl border border-[var(--color-line-soft)] p-2.5 text-[12.5px]">
      <b className="text-[var(--color-ink)]">{item.question}</b>
      <p className="mt-0.5 text-[var(--color-ink-3)]">{item.why}</p>
      <div className="mt-1.5 flex gap-1.5">
        <MiniAct onClick={() => onResolve(item.id, 'ASK_NEXT', 'acted', item.question)}>
          Asked ✓
        </MiniAct>
        <MiniAct quiet onClick={() => onResolve(item.id, 'ASK_NEXT', 'dismissed', item.question)}>
          Skip
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
    <div className="rounded-xl border border-[var(--color-line-soft)] p-2.5 text-[12.5px]">
      <div className="flex items-baseline justify-between gap-2">
        <b className="text-[var(--color-ink)]">{item.topic}</b>
        {item.mentions > 1 && (
          <span className="text-[10px] font-medium text-[var(--color-ink-3)]">
            ×{item.mentions}
          </span>
        )}
      </div>
      <p className="mt-0.5 text-[var(--color-ink-3)]">{item.note}</p>
      <div className="mt-1.5 flex gap-1.5">
        <MiniAct onClick={() => onResolve(item.id, 'GAP', 'acted', item.topic)}>Explore</MiniAct>
        <MiniAct quiet onClick={() => onResolve(item.id, 'GAP', 'dismissed', item.topic)}>
          Dismiss
        </MiniAct>
      </div>
    </div>
  );
}

function MiniAct({
  children,
  onClick,
  quiet = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  quiet?: boolean;
}) {
  return (
    // TS7.5 — tapped mid-conversation, half-looking: the label stays small
    // but py-2/px-3 grows the hit area toward the 44px minimum without
    // reshaping the rail.
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-2 text-[11px] font-semibold transition-colors ${
        quiet
          ? 'text-[var(--color-ink-3)] hover:text-[var(--color-ink)]'
          : 'border border-[var(--color-line)] bg-white text-[var(--color-accent)] hover:border-[var(--color-accent)]'
      }`}
    >
      {children}
    </button>
  );
}
