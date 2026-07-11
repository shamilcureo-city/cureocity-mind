'use client';

import type {
  TherapyAskNextItem,
  TherapyReasoningV1,
  TherapyRiskWatchItem,
  TherapyThreadItem,
} from '@cureocity/contracts';
import { Card } from '../ui/Card';

/**
 * Sprint TS5 — the live therapy copilot rail.
 *
 * Renders the PASS_12 snapshot the gateway streams during a session: a risk
 * watch, "ask next" (planned questions the therapist carried in + live cues),
 * threads the client raised but didn't explore, and a session-pacing clock.
 * Every card is passive — one tap to mark it asked/explored or to dismiss it,
 * both of which stop the gateway re-suggesting it and write an audit row. An
 * "AI" tag on the header keeps it visually distinct from what the therapist
 * has decided, doctor-style.
 */
export function TherapyCopilotRail({
  reasoning,
  onResolve,
}: {
  reasoning: TherapyReasoningV1;
  onResolve: (
    id: string,
    kind: 'ASK_NEXT' | 'RED_FLAG' | 'GAP',
    event: 'acted' | 'dismissed',
    label?: string,
  ) => void;
}) {
  const { riskWatch, askNext, threads, arc } = reasoning;
  const nothing = riskWatch.length === 0 && askNext.length === 0 && threads.length === 0;

  return (
    <Card className="overflow-hidden border-t-[3px] border-t-[#d9c9a3] p-0">
      <div className="flex items-center gap-2 px-4 pb-2 pt-3.5">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
          Copilot
        </h2>
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

      {askNext.length > 0 && (
        <RailSection title="Ask next">
          {askNext.map((a) => (
            <AskCard key={a.id} item={a} onResolve={onResolve} />
          ))}
        </RailSection>
      )}

      {threads.length > 0 && (
        <RailSection title="Threads not followed">
          {threads.map((t) => (
            <ThreadCard key={t.id} item={t} onResolve={onResolve} />
          ))}
        </RailSection>
      )}

      {nothing && (
        <div className="px-4 pb-3 text-[13px] text-[var(--color-ink-3)]">
          Listening — nothing needs your attention right now.
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
      <span
        className={`ml-1.5 rounded-full px-1.5 py-px text-[9.5px] font-bold tracking-wide ${
          item.source === 'CARRIED'
            ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
            : 'bg-[#f6efdc] text-[#8a7434]'
        }`}
      >
        {item.source === 'CARRIED' ? 'PLANNED' : 'LIVE'}
      </span>
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
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition-colors ${
        quiet
          ? 'text-[var(--color-ink-3)] hover:text-[var(--color-ink)]'
          : 'border border-[var(--color-line)] bg-white text-[var(--color-accent)] hover:border-[var(--color-accent)]'
      }`}
    >
      {children}
    </button>
  );
}
