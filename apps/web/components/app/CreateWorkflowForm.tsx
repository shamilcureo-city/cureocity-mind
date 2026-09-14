'use client';

import { useState, type FormEvent } from 'react';
import type { ModalityStateWithHistory } from '@cureocity/contracts';
import { EMDR_INITIAL_PHASE } from '@cureocity/clinical';
import { Label, Select, Textarea } from '../ui/Field';
import { Button } from '../ui/Button';

interface Props {
  clientId: string;
  scribeBase?: string;
  onCreated: (workflow: ModalityStateWithHistory) => void;
}

const CBT_PHASE_OPTIONS = [
  { value: 'engagement_assessment', label: 'Engagement & assessment' },
  { value: 'psychoeducation', label: 'Psychoeducation' },
  { value: 'cognitive_restructuring', label: 'Cognitive restructuring' },
  { value: 'behavioral_activation', label: 'Behavioral activation' },
  { value: 'consolidation_relapse_prevention', label: 'Consolidation & relapse prevention' },
];

const EMDR_PHASE_OPTIONS = [{ value: EMDR_INITIAL_PHASE, label: 'History taking' }];

/**
 * Starts a new ModalityState for a client. The form collects the
 * modality, initial phase (defaults to the canonical start for that
 * modality), and 1+ goals as one-goal-per-line free text. Goals get a
 * stable id assigned server-side via the {Date.now()} fallback in the
 * POST /workflows route.
 */
export function CreateWorkflowForm({ clientId, scribeBase = '/api/v1', onCreated }: Props) {
  const [modality, setModality] = useState<'CBT' | 'EMDR'>('CBT');
  const [initialPhase, setInitialPhase] = useState<string>('engagement_assessment');
  const [goalsText, setGoalsText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const phaseOptions = modality === 'CBT' ? CBT_PHASE_OPTIONS : EMDR_PHASE_OPTIONS;

  function onModalityChange(next: 'CBT' | 'EMDR') {
    setModality(next);
    setInitialPhase(next === 'CBT' ? 'engagement_assessment' : EMDR_INITIAL_PHASE);
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const goals = goalsText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((description, i) => ({ id: `goal-${i + 1}`, description }));
    if (goals.length === 0) {
      setError('Add at least one treatment goal — one per line.');
      return;
    }
    if (goals.length > 20) {
      setError('Maximum 20 goals at intake. Trim the list.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${scribeBase}/workflows`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientId, modality, initialPhase, goals }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const created = (await res.json()) as ModalityStateWithHistory;
      onCreated(created);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label htmlFor="wf-modality">Modality</Label>
          <Select
            id="wf-modality"
            value={modality}
            onChange={(e) => onModalityChange(e.target.value as 'CBT' | 'EMDR')}
          >
            <option value="CBT">CBT — Cognitive Behavioral Therapy</option>
            <option value="EMDR">EMDR — Eye Movement Desensitization & Reprocessing</option>
          </Select>
        </div>
        <div>
          <Label
            htmlFor="wf-phase"
            hint={
              modality === 'EMDR'
                ? 'New workflows begin at history taking'
                : 'Defaults to canonical start'
            }
          >
            Starting phase
          </Label>
          <Select
            id="wf-phase"
            value={initialPhase}
            onChange={(e) => setInitialPhase(e.target.value)}
            disabled={modality === 'EMDR'}
            aria-describedby={modality === 'EMDR' ? 'wf-emdr-entry-help' : undefined}
          >
            {phaseOptions.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
          {modality === 'EMDR' && (
            <p id="wf-emdr-entry-help" className="mt-2 text-xs text-[var(--color-ink-2)]">
              Later phases use the recorded preparation and target checks. Starting from prior care
              is not available yet. Existing workflows and session records remain available.
            </p>
          )}
        </div>
      </div>
      <div>
        <Label htmlFor="wf-goals" hint="One per line · 1–20 goals">
          Treatment goals
        </Label>
        <Textarea
          id="wf-goals"
          rows={5}
          placeholder={
            'One goal per line — e.g. Practice one coping skill daily\nReturn to valued activities\nRebuild sleep routine'
          }
          value={goalsText}
          onChange={(e) => setGoalsText(e.target.value)}
        />
      </div>
      {error && <p className="text-sm text-[var(--color-warn)]">{error}</p>}
      <div className="flex justify-end">
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Starting…' : 'Start workflow'}
        </Button>
      </div>
    </form>
  );
}
