'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AdvancementSuggestion,
  ModalityStateWithHistory,
} from '@cureocity/contracts';
import { Badge } from '../ui/Badge';
import { CreateWorkflowForm } from './CreateWorkflowForm';
import { EmdrPanel } from './EmdrPanel';

interface ExerciseRecommendation {
  exerciseId: string;
  title: string;
  score: number;
  rationale: string[];
}

interface PrescribedExercisesResponse {
  workflowId: string;
  currentPhase: string;
  modality: string;
  recommendations: ExerciseRecommendation[];
}

interface Props {
  clientId: string;
  scribeBase?: string;
}

/**
 * Client-side workflow card embedded in the Client tab. Fetches the
 * current ModalityState (or shows a "no workflow yet" CTA), plus the
 * AI advancement suggestion + prescribed exercises when the workflow
 * is in CBT mode. All endpoints introduced in Sprint 3b.
 */
export function WorkflowSection({ clientId, scribeBase = '/api/v1' }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workflow, setWorkflow] = useState<ModalityStateWithHistory | null>(null);
  const [advancement, setAdvancement] = useState<AdvancementSuggestion | null>(null);
  const [exercises, setExercises] = useState<PrescribedExercisesResponse | null>(null);
  const [transitionPending, setTransitionPending] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const wfRes = await fetch(`${scribeBase}/clients/${clientId}/workflow`);
      if (wfRes.status === 404) {
        setWorkflow(null);
        setAdvancement(null);
        setExercises(null);
        return;
      }
      if (!wfRes.ok) {
        const body = (await wfRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${wfRes.status}`);
      }
      const wf = (await wfRes.json()) as ModalityStateWithHistory;
      setWorkflow(wf);

      // Only CBT has advancement + prescription wired in Sprint 3b.
      if (wf.modality === 'CBT') {
        const [advRes, exRes] = await Promise.all([
          fetch(`${scribeBase}/workflows/${wf.id}/advancement-suggestion`),
          fetch(`${scribeBase}/workflows/${wf.id}/prescribed-exercises`),
        ]);
        if (advRes.ok) setAdvancement((await advRes.json()) as AdvancementSuggestion);
        if (exRes.ok) setExercises((await exRes.json()) as PrescribedExercisesResponse);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [clientId, scribeBase]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const toggleGoal = useCallback(
    async (goalId: string, achieved: boolean) => {
      if (!workflow) return;
      setError(null);
      try {
        const res = await fetch(
          `${scribeBase}/workflows/${workflow.id}/goals/${goalId}`,
          {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ achieved }),
          },
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const updated = (await res.json()) as ModalityStateWithHistory;
        setWorkflow(updated);
        // Goal flips can change the advancement signal — refresh advice.
        if (updated.modality === 'CBT') {
          const advRes = await fetch(
            `${scribeBase}/workflows/${workflow.id}/advancement-suggestion`,
          );
          if (advRes.ok) setAdvancement((await advRes.json()) as AdvancementSuggestion);
        }
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [scribeBase, workflow],
  );

  const acceptSuggestion = useCallback(async () => {
    if (!workflow || !advancement?.suggestedPhase) return;
    setTransitionPending(true);
    setError(null);
    try {
      const res = await fetch(`${scribeBase}/workflows/${workflow.id}/transitions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          toPhase: advancement.suggestedPhase,
          reason: `Advancement suggestion accepted (confidence ${(advancement.confidence * 100).toFixed(0)}%). ${advancement.rationale}`,
          evidence: advancement.signals,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      await loadAll();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTransitionPending(false);
    }
  }, [advancement, scribeBase, workflow, loadAll]);

  const headline = useMemo(() => {
    if (!workflow) return null;
    return phaseToLabel(workflow.currentPhase);
  }, [workflow]);

  if (loading) {
    return (
      <section className="rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-6">
        <h3 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
          Workflow
        </h3>
        <p className="mt-3 text-sm text-[var(--color-ink-3)]">Loading workflow…</p>
      </section>
    );
  }

  if (!workflow) {
    return (
      <section className="rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-6">
        <h3 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
          Workflow
        </h3>
        <p className="mt-3 text-sm text-[var(--color-ink-2)]">
          No clinical workflow has been started for this client yet. Workflows track CBT or
          EMDR phase progression, goal achievement, and exercise prescription. Starting one
          enables the advancement-suggestion engine on subsequent sessions.
        </p>
        <CreateWorkflowForm
          clientId={clientId}
          scribeBase={scribeBase}
          onCreated={(wf) => {
            setWorkflow(wf);
            void loadAll();
          }}
        />
        {error && <p className="mt-3 text-xs text-[var(--color-warn)]">{error}</p>}
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-6">
        <header className="flex flex-wrap items-baseline justify-between gap-3">
          <h3 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
            {workflow.modality} workflow
          </h3>
          <Badge tone="muted">
            {workflow.transitions.length} transition{workflow.transitions.length === 1 ? '' : 's'}
          </Badge>
        </header>
        <p className="mt-3 font-serif text-xl">{headline}</p>
        <p className="mt-2 text-xs text-[var(--color-ink-3)]">
          Started {new Date(workflow.startedAt).toLocaleDateString('en-US', { dateStyle: 'medium' })}
          {workflow.goals.length > 0 && (
            <>
              {' · '}
              {workflow.goals.filter((g) => g.achieved).length} / {workflow.goals.length}{' '}
              goals achieved
            </>
          )}
        </p>

        {workflow.goals.length > 0 && (
          <ul className="mt-4 space-y-2">
            {workflow.goals.map((g) => (
              <li key={g.id} className="flex items-start gap-3">
                <input
                  id={`goal-${g.id}`}
                  type="checkbox"
                  checked={g.achieved}
                  onChange={(e) => void toggleGoal(g.id, e.target.checked)}
                  className="mt-1 h-4 w-4 accent-[var(--color-accent)]"
                />
                <label htmlFor={`goal-${g.id}`} className="flex-1 cursor-pointer">
                  <span
                    className={`block text-sm ${
                      g.achieved
                        ? 'text-[var(--color-ink-3)] line-through'
                        : 'text-[var(--color-ink)]'
                    }`}
                  >
                    {g.description}
                  </span>
                  {g.achieved && g.achievedAt && (
                    <span className="block text-[11px] text-[var(--color-ink-3)]">
                      Achieved{' '}
                      {new Date(g.achievedAt).toLocaleDateString('en-US', { dateStyle: 'medium' })}
                    </span>
                  )}
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      {workflow.modality === 'CBT' && advancement && (
        <div
          className={`rounded-2xl border p-6 ${
            advancement.suggestedPhase
              ? 'border-[var(--color-line-soft)] bg-[var(--color-surface)]'
              : 'border-[var(--color-line-soft)] bg-[var(--color-surface)]'
          }`}
        >
          <h4 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
            Advancement suggestion
          </h4>
          {advancement.suggestedPhase ? (
            <div className="mt-3 space-y-3">
              <p className="text-sm text-[var(--color-ink)]">
                Advance to <strong>{phaseToLabel(advancement.suggestedPhase)}</strong>{' '}
                <span className="text-[var(--color-ink-3)]">
                  (confidence {(advancement.confidence * 100).toFixed(0)}%)
                </span>
              </p>
              <p className="text-sm leading-relaxed text-[var(--color-ink-2)]">
                {advancement.rationale}
              </p>
              <button
                type="button"
                onClick={acceptSuggestion}
                disabled={transitionPending}
                className="rounded-full bg-[var(--color-ink)] px-4 py-2 text-sm font-medium text-[var(--color-surface)] hover:bg-[var(--color-ink-2)] disabled:opacity-50"
              >
                {transitionPending ? 'Advancing…' : 'Accept and advance'}
              </button>
            </div>
          ) : (
            <p className="mt-3 text-sm leading-relaxed text-[var(--color-ink-2)]">
              {advancement.rationale}
            </p>
          )}
        </div>
      )}

      {workflow.modality === 'CBT' && exercises && exercises.recommendations.length > 0 && (
        <div className="rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-6">
          <h4 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
            Prescribed exercises
          </h4>
          <ol className="mt-3 space-y-3">
            {exercises.recommendations.map((r) => (
              <li
                key={r.exerciseId}
                className="border-b border-[var(--color-line-soft)] pb-3 last:border-b-0 last:pb-0"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-medium text-[var(--color-ink)]">{r.title}</span>
                  <span className="text-xs text-[var(--color-ink-3)]">score {r.score}</span>
                </div>
                {r.rationale.length > 0 && (
                  <ul className="mt-1 list-inside list-disc text-xs text-[var(--color-ink-3)]">
                    {r.rationale.map((reason, i) => (
                      <li key={i}>{reason}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      {workflow.modality === 'EMDR' && (
        <EmdrPanel
          workflow={workflow}
          scribeBase={scribeBase}
          onWorkflowChange={(next) => setWorkflow(next)}
        />
      )}

      {error && (
        <div className="rounded-2xl border border-[var(--color-warn-border)] bg-[var(--color-warn-bg)] p-4 text-sm text-[var(--color-warn)]">
          {error}
        </div>
      )}
    </section>
  );
}

function phaseToLabel(phase: string): string {
  return phase
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
