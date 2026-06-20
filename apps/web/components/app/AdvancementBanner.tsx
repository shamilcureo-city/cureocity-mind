'use client';

import { useEffect, useState } from 'react';
import type { AdvancementSuggestion } from '@cureocity/contracts';

interface Props {
  clientId: string;
  scribeBase?: string;
}

/**
 * Slim "post-session" suggestion strip rendered above the signed note.
 * Looks up the client's workflow, runs the CBT advancement evaluator,
 * and only shows itself if there's a concrete suggestion to advance.
 * If there's no workflow, or the suggestion says "stay put", the
 * banner is invisible — we don't want to add noise to the Notes view.
 */
export function AdvancementBanner({ clientId, scribeBase = '/api/v1' }: Props) {
  const [suggestion, setSuggestion] = useState<AdvancementSuggestion | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const wfRes = await fetch(`${scribeBase}/clients/${clientId}/workflow`);
        if (!wfRes.ok) return;
        const wf = (await wfRes.json()) as { id: string; modality: string };
        if (wf.modality !== 'CBT') return;
        const advRes = await fetch(`${scribeBase}/workflows/${wf.id}/advancement-suggestion`);
        if (!advRes.ok) return;
        const adv = (await advRes.json()) as AdvancementSuggestion;
        if (!cancelled && adv.suggestedPhase) setSuggestion(adv);
      } catch {
        // Silent failure — banner is non-critical.
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [clientId, scribeBase]);

  if (!suggestion || !suggestion.suggestedPhase) return null;

  return (
    <div className="mb-4 rounded-2xl border border-[var(--color-accent)] bg-[var(--color-accent-soft)] p-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
          Workflow suggestion
        </span>
        <span className="text-xs text-[var(--color-ink-3)]">
          confidence {(suggestion.confidence * 100).toFixed(0)}%
        </span>
      </div>
      <p className="mt-2 text-sm text-[var(--color-ink)]">
        Based on this note, consider advancing to{' '}
        <strong>{phaseToLabel(suggestion.suggestedPhase)}</strong>.
      </p>
      <p className="mt-1 text-sm text-[var(--color-ink-2)]">{suggestion.rationale}</p>
      <p className="mt-2 text-xs text-[var(--color-ink-3)]">
        Review and accept from the <em>Client</em> tab.
      </p>
    </div>
  );
}

function phaseToLabel(phase: string): string {
  return phase
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
