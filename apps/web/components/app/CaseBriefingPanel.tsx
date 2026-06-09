'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CaseBriefingV1, CaseBriefingWhen } from '@cureocity/contracts';
import { Badge } from '../ui/Badge';
import { Card } from '../ui/Card';
import { InfoTip } from '../ui/InfoTip';
import { ClientCaseChat } from './ClientCaseChat';

interface Props {
  clientId: string;
  clientName: string;
  initialBriefing: CaseBriefingV1;
}

const WHEN_LABEL: Record<CaseBriefingWhen, string> = {
  this_session: 'This session',
  next_session: 'Next session',
  this_week: 'This week',
  before_review: 'Before review',
};

const WHEN_TONE: Record<CaseBriefingWhen, 'accent' | 'warn' | 'muted'> = {
  this_session: 'warn',
  next_session: 'accent',
  this_week: 'muted',
  before_review: 'muted',
};

/**
 * Sprint 22 — the Case Briefing: the anchor of the Case Workspace.
 *
 * Answers the four questions a therapist has when the client is in front
 * of them: what's going on (5 Ps), what's still open (the running
 * differential, closeable inline), the next 1-3 actions (each with a
 * why + a when), and when to see them again. Server-renders the
 * deterministic briefing; "Refresh" runs Pass 6 for the LLM narrative.
 */
export function CaseBriefingPanel({ clientId, clientName, initialBriefing }: Props) {
  const router = useRouter();
  const [briefing, setBriefing] = useState<CaseBriefingV1>(initialBriefing);
  const [refreshing, setRefreshing] = useState(false);
  const [showFormulation, setShowFormulation] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  async function refresh(): Promise<void> {
    setRefreshing(true);
    try {
      const res = await fetch(`/api/v1/clients/${clientId}/case-briefing`, { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as { briefing?: CaseBriefingV1 };
      if (res.ok && body.briefing) setBriefing(body.briefing);
    } finally {
      setRefreshing(false);
    }
  }

  const firstName = clientName.trim().split(/\s+/)[0] ?? clientName;

  return (
    <Card className="p-7">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-accent)]">
            Case briefing
          </p>
          <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-[var(--color-ink)]">
            {briefing.headline}
          </p>
          {briefing.workingDiagnosis && (
            <p className="mt-2 text-sm text-[var(--color-ink-2)]">
              <span className="font-mono">{briefing.workingDiagnosis.icd11Code}</span>{' '}
              {briefing.workingDiagnosis.icd11Label}{' '}
              <span className="text-[var(--color-ink-3)]">
                ·{' '}
                {briefing.workingDiagnosis.confirmed
                  ? 'confirmed'
                  : `working (${Math.round(briefing.workingDiagnosis.confidence * 100)}%)`}
              </span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={briefing.source === 'llm' ? 'accent' : 'muted'}>
            {briefing.source === 'llm' ? 'AI synthesis' : 'computed'}
          </Badge>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing}
            className="rounded-full border border-[var(--color-line)] bg-white px-3 py-1.5 text-sm text-[var(--color-ink-2)] hover:border-[var(--color-ink-3)] disabled:opacity-50"
          >
            {refreshing ? 'Thinking…' : 'Refresh'}
          </button>
        </div>
      </header>

      {/* Safety surfaces first, never buried. */}
      {briefing.safety.highestSeverity !== 'none' && briefing.safety.highestSeverity !== 'low' && (
        <div
          className="mt-5 rounded-2xl border-2 border-[var(--color-warn-border)] bg-[var(--color-warn-bg)] p-4"
          role="alert"
        >
          <p className="text-sm font-semibold text-[var(--color-warn)]">
            Safety — severity {briefing.safety.highestSeverity}
          </p>
          <p className="mt-1 text-sm text-[var(--color-ink-2)]">
            {briefing.safety.openCrisisFlags.join(', ')}.{' '}
            {briefing.safety.hasSafetyPlan
              ? 'A safety plan is on file — review it.'
              : 'No safety plan on file.'}
          </p>
        </div>
      )}

      {/* 5 Ps formulation — collapsible. */}
      <div className="mt-5">
        <button
          type="button"
          onClick={() => setShowFormulation((s) => !s)}
          className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-3)] hover:text-[var(--color-ink)]"
        >
          What's going on with this person
          <span aria-hidden>{showFormulation ? '▾' : '▸'}</span>
        </button>
        {showFormulation && (
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            <FormulationP
              label="What's happening now"
              clinical="presenting"
              hint="The current complaints and symptoms the client is bringing to the room."
              body={briefing.formulation.presenting}
            />
            <FormulationP
              label="What set this up over time"
              clinical="predisposing"
              hint="Long-standing factors — temperament, early history, biology — that made the client vulnerable to this presentation."
              body={briefing.formulation.predisposing}
            />
            <FormulationP
              label="What triggered it"
              clinical="precipitating"
              hint="The recent events or stressors that brought the symptoms to a head right now."
              body={briefing.formulation.precipitating}
            />
            <FormulationP
              label="What keeps it going"
              clinical="perpetuating"
              hint="The thoughts, behaviours or situations that maintain the symptoms day to day — typically what treatment targets."
              body={briefing.formulation.perpetuating}
            />
            <FormulationP
              label="What's helping"
              clinical="protective"
              hint="Strengths, supports and coping that buffer the client against deterioration — to preserve and build on."
              body={briefing.formulation.protective}
            />
          </dl>
        )}
      </div>

      {/* Open assessment items. */}
      <div className="mt-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-3)]">
          Still to find out · {briefing.openItems.length}{' '}
          <span className="font-normal text-[var(--color-ink-3)]">
            (questions to answer at the next visit)
          </span>
        </p>
        {briefing.openItems.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--color-ink-3)]">
            Nothing outstanding — the picture is clear enough to proceed.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {briefing.openItems.map((item) => (
              <OpenItemRow
                key={item.id}
                clientId={clientId}
                item={item}
                onClosed={() => router.refresh()}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Next actions. */}
      <div className="mt-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-3)]">
          Do next
        </p>
        {briefing.nextActions.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--color-ink-3)]">No action pending.</p>
        ) : (
          <ol className="mt-2 space-y-2.5">
            {briefing.nextActions.map((a, i) => (
              <li
                key={i}
                className="rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="font-medium">
                    <span className="mr-2 text-[var(--color-ink-3)]">{i + 1}.</span>
                    {a.title}
                  </p>
                  <Badge tone={WHEN_TONE[a.when]}>{WHEN_LABEL[a.when]}</Badge>
                </div>
                <p className="mt-1 text-sm text-[var(--color-ink-2)]">{a.detail}</p>
                <p className="mt-1 text-xs italic text-[var(--color-ink-3)]">Why: {a.why}</p>
                {a.ctaLabel && a.ctaHref && (
                  <a
                    href={a.ctaHref}
                    className="mt-2 inline-flex items-center rounded-full bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)]"
                  >
                    {a.ctaLabel}
                  </a>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* Cadence. */}
      <div className="mt-6 rounded-2xl border border-[var(--color-line-soft)] px-4 py-3">
        <p className="text-sm">
          <span className="font-medium">Next session:</span> in ~
          {briefing.cadence.recommendedIntervalDays} days
          {briefing.cadence.reviewDueInSessions === 0 && (
            <span className="ml-1 text-[var(--color-warn)]">· plan review due</span>
          )}
        </p>
        <p className="mt-0.5 text-xs text-[var(--color-ink-3)]">{briefing.cadence.rationale}</p>
      </div>

      {/* Client-aware chat. */}
      <div className="mt-6 border-t border-[var(--color-line-soft)] pt-4">
        <button
          type="button"
          onClick={() => setChatOpen((s) => !s)}
          className="flex items-center gap-2 text-sm font-medium text-[var(--color-accent)]"
        >
          {chatOpen ? '▾' : '▸'} Ask about {firstName}
        </button>
        {chatOpen && <ClientCaseChat clientId={clientId} clientName={firstName} />}
      </div>
    </Card>
  );
}

function FormulationP({
  label,
  clinical,
  hint,
  body,
}: {
  label: string;
  clinical: string;
  hint: string;
  body: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--color-line-soft)] bg-white/40 p-3">
      <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-3)]">
        {label}
        <span className="ml-2 normal-case tracking-normal">
          <InfoTip hint={hint}>({clinical})</InfoTip>
        </span>
      </dt>
      <dd className="mt-1 text-sm leading-relaxed text-[var(--color-ink)]">{body}</dd>
    </div>
  );
}

function OpenItemRow({
  clientId,
  item,
  onClosed,
}: {
  clientId: string;
  item: CaseBriefingV1['openItems'][number];
  onClosed: () => void;
}) {
  const [closing, setClosing] = useState(false);
  const [showFinding, setShowFinding] = useState(false);
  const [finding, setFinding] = useState('');
  const [done, setDone] = useState(false);

  // Synthetic items (baseline / safety) aren't backed by a row — they
  // resolve when the therapist does the action, not via this control.
  const closeable = !item.id.startsWith('synthetic-');

  async function close(): Promise<void> {
    setClosing(true);
    try {
      const res = await fetch(`/api/v1/clients/${clientId}/assessment-items/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'CLOSED', resolutionNote: finding.trim() || undefined }),
      });
      if (res.ok) {
        setDone(true);
        onClosed();
      }
    } finally {
      setClosing(false);
    }
  }

  if (done) return null;

  return (
    <li className="rounded-xl border border-[var(--color-line-soft)] bg-white/40 p-3">
      <div className="flex items-start gap-2">
        {closeable ? (
          <button
            type="button"
            onClick={() => setShowFinding((s) => !s)}
            aria-label="Mark addressed"
            className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border border-[var(--color-line)] bg-white text-[10px] text-[var(--color-ink-3)] hover:border-[var(--color-accent)]"
          >
            ◯
          </button>
        ) : (
          <span
            aria-hidden
            className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-accent)]"
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{item.question}</p>
          <p className="mt-0.5 text-xs text-[var(--color-ink-3)]">{item.rationale}</p>
        </div>
        {item.icd11Code && <Badge tone="muted">{item.icd11Code}</Badge>}
      </div>
      {showFinding && closeable && (
        <div className="mt-2 pl-6">
          <input
            type="text"
            value={finding}
            onChange={(e) => setFinding(e.target.value)}
            placeholder="One-line finding (optional)…"
            className="w-full rounded-lg border border-[var(--color-line)] bg-white px-3 py-1.5 text-sm"
          />
          <div className="mt-1.5 flex gap-2">
            <button
              type="button"
              onClick={() => void close()}
              disabled={closing}
              className="rounded-full bg-[var(--color-accent)] px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
            >
              {closing ? 'Closing…' : 'Close item'}
            </button>
            <button
              type="button"
              onClick={() => setShowFinding(false)}
              className="rounded-full px-3 py-1 text-xs text-[var(--color-ink-3)]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
