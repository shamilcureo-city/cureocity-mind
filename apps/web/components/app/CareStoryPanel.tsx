'use client';

import { useState } from 'react';
import type { CaseBriefingV1 } from '@cureocity/contracts';
import { Badge } from '../ui/Badge';
import { Card } from '../ui/Card';
import { InfoTip } from '../ui/InfoTip';
import { ClientCaseChat } from './ClientCaseChat';

interface Props {
  clientId: string;
  clientName: string;
  initialBriefing: CaseBriefingV1;
}

/**
 * Sprint JE3 — The story so far, zone [4] of the Care Engine page.
 *
 * A deliberately slimmed CaseBriefingPanel. It keeps only the *narrative*:
 * the one-line headline, the working diagnosis, the 5 Ps formulation, and
 * the "ask about this client" chat. Everything actionable that the old
 * briefing carried — the safety alert, the "still to find out" list, the
 * "do next" actions and the cadence line — now lives in the Care Engine's
 * arc gate, ranked queue, carried-questions panel and cadence. This panel
 * is the synthesis you read; the queue is the thing you do. No duplication.
 */
export function CareStoryPanel({ clientId, clientName, initialBriefing }: Props) {
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
            The story so far
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

      {/* 5 Ps formulation — collapsible. */}
      <div className="mt-5">
        <button
          type="button"
          onClick={() => setShowFormulation((s) => !s)}
          className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-3)] hover:text-[var(--color-ink)]"
        >
          What&rsquo;s going on with this person
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
