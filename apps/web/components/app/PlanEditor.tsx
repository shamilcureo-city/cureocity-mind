'use client';

import { useState } from 'react';
import type { ClinicalTreatmentPlan } from '@cureocity/contracts';
import { Button } from '../ui/Button';

// Plan modality options — kept as a literal so we don't pull the Zod
// enum value into this client bundle. Order matches the contract.
const PLAN_MODALITIES: ClinicalTreatmentPlan['modality'][] = [
  'CBT',
  'EMDR',
  'supportive',
  'mixed',
  'other',
];

/**
 * Sprint 35 — inline treatment-plan editor.
 *
 * Extracted to its own module when the rest of ClinicalBriefTab was deleted
 * (the decision board replaced that tab; this editor was the one live export
 * left inside ~1,200 dead lines).
 *
 * Lets the therapist edit the AI's proposed plan (modality, duration,
 * reorderable phase sequence, measurable goals) before accepting. Validation
 * mirrors ClinicalTreatmentPlanSchema so the submit button is only enabled
 * for a body the route will accept; the server re-validates regardless.
 *
 * `requireReason` — the treatment modify path persists the reason into the
 * plan's version history, so it stays required there. The intake draft path
 * runs through a route that never reads it; forcing a typed sentence on every
 * single intake was a pure friction tax, so intake passes false and the field
 * disappears.
 */
export function PlanEditor({
  initialPlan,
  busy,
  error,
  onCancel,
  onSubmit,
  requireReason = true,
}: {
  initialPlan: ClinicalTreatmentPlan;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (edits: unknown, reason: string) => void;
  requireReason?: boolean;
}) {
  type Goal = ClinicalTreatmentPlan['goals'][number];
  const [modality, setModality] = useState<ClinicalTreatmentPlan['modality']>(initialPlan.modality);
  const [phases, setPhases] = useState<string[]>([...initialPlan.phaseSequence]);
  const [goals, setGoals] = useState<Goal[]>(initialPlan.goals.map((g) => ({ ...g })));
  const [duration, setDuration] = useState<number | null>(initialPlan.expectedDurationSessions);
  const [reason, setReason] = useState('');

  const cleanPhases = phases.map((p) => p.trim()).filter((p) => p.length > 0);
  const cleanGoals = goals
    .map((g) => ({ description: g.description.trim(), measure: g.measure.trim() }))
    .filter((g) => g.description.length > 0 && g.measure.length > 0);

  const problems: string[] = [];
  if (cleanPhases.length < 2) problems.push('Add at least 2 phases.');
  if (cleanPhases.length > 10) problems.push('No more than 10 phases.');
  if (phases.some((p) => p.length > 120))
    problems.push('Each phase must be 120 characters or fewer.');
  if (cleanGoals.length < 1)
    problems.push('Add at least 1 goal with both a description and a measure.');
  if (cleanGoals.length > 8) problems.push('No more than 8 goals.');
  if (goals.some((g) => g.description.length > 400 || g.measure.length > 400))
    problems.push('Each goal field must be 400 characters or fewer.');
  if (duration !== null && (duration < 1 || duration > 60))
    problems.push('Expected duration must be between 1 and 60 sessions.');
  if (requireReason && reason.trim().length === 0)
    problems.push('Add a short reason for the change.');
  const valid = problems.length === 0;

  const setPhase = (i: number, v: string) => setPhases((ps) => ps.map((p, j) => (j === i ? v : p)));
  const addPhase = () => setPhases((ps) => [...ps, '']);
  const removePhase = (i: number) => setPhases((ps) => ps.filter((_, j) => j !== i));
  const movePhase = (i: number, dir: -1 | 1) =>
    setPhases((ps) => {
      const j = i + dir;
      if (j < 0 || j >= ps.length) return ps;
      const next = [...ps];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  const setGoal = (i: number, patch: Partial<Goal>) =>
    setGoals((gs) => gs.map((g, j) => (j === i ? { ...g, ...patch } : g)));
  const addGoal = () =>
    setGoals((gs) => [...gs, { description: '', measure: '', interventions: [] }]);
  const removeGoal = (i: number) => setGoals((gs) => gs.filter((_, j) => j !== i));

  const handleSubmit = () => {
    if (!valid) return;
    onSubmit(
      {
        treatmentPlan: {
          modality,
          phaseSequence: cleanPhases,
          goals: cleanGoals,
          expectedDurationSessions: duration,
        },
      },
      reason.trim(),
    );
  };

  const fieldCls =
    'w-full rounded-xl border border-[var(--color-line-soft)] bg-white/60 p-2.5 text-sm';

  return (
    <div className="space-y-5 rounded-2xl border border-[var(--color-accent)]/40 bg-[var(--color-accent-soft)]/30 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-accent)]">
        Editing the plan — your version is what gets versioned and saved
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
            Modality
          </label>
          <select
            value={modality}
            onChange={(e) => setModality(e.target.value as ClinicalTreatmentPlan['modality'])}
            className={`${fieldCls} mt-1 capitalize`}
          >
            {PLAN_MODALITIES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
            Expected duration
          </label>
          <div className="mt-1 flex items-center gap-3">
            <input
              type="number"
              min={1}
              max={60}
              value={duration ?? ''}
              disabled={duration === null}
              onChange={(e) => setDuration(e.target.value === '' ? null : Number(e.target.value))}
              className={`${fieldCls} w-28 disabled:opacity-40`}
              placeholder="sessions"
            />
            <label className="flex items-center gap-1.5 text-xs text-[var(--color-ink-2)]">
              <input
                type="checkbox"
                checked={duration === null}
                onChange={(e) => setDuration(e.target.checked ? null : 8)}
              />
              Too uncertain
            </label>
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <label className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
            Phase sequence
          </label>
          <span className="text-[11px] text-[var(--color-ink-3)]">{cleanPhases.length}/10</span>
        </div>
        <ol className="mt-2 space-y-2">
          {phases.map((p, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className="w-5 text-center text-xs text-[var(--color-ink-3)]">{i + 1}</span>
              <input
                value={p}
                maxLength={120}
                onChange={(e) => setPhase(i, e.target.value)}
                className={fieldCls}
                placeholder="e.g. Stabilisation"
              />
              <div className="flex shrink-0 items-center gap-1">
                <IconBtn label="Move phase up" onClick={() => movePhase(i, -1)} disabled={i === 0}>
                  ↑
                </IconBtn>
                <IconBtn
                  label="Move phase down"
                  onClick={() => movePhase(i, 1)}
                  disabled={i === phases.length - 1}
                >
                  ↓
                </IconBtn>
                <IconBtn
                  label="Remove phase"
                  onClick={() => removePhase(i)}
                  disabled={phases.length <= 1}
                >
                  ×
                </IconBtn>
              </div>
            </li>
          ))}
        </ol>
        <button
          type="button"
          onClick={addPhase}
          disabled={phases.length >= 10}
          className="mt-2 text-xs font-medium text-[var(--color-accent)] disabled:opacity-40"
        >
          + Add phase
        </button>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <label className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">Goals</label>
          <span className="text-[11px] text-[var(--color-ink-3)]">{cleanGoals.length}/8</span>
        </div>
        <ul className="mt-2 space-y-2">
          {goals.map((g, i) => (
            <li
              key={i}
              className="rounded-xl border border-[var(--color-line-soft)] bg-white/40 p-3"
            >
              <div className="flex items-start gap-2">
                <div className="flex-1 space-y-2">
                  <input
                    value={g.description}
                    maxLength={400}
                    onChange={(e) => setGoal(i, { description: e.target.value })}
                    className={fieldCls}
                    placeholder="Goal — what changes for the client?"
                  />
                  <input
                    value={g.measure}
                    maxLength={400}
                    onChange={(e) => setGoal(i, { measure: e.target.value })}
                    className={fieldCls}
                    placeholder="Measure — how will you know?"
                  />
                </div>
                <IconBtn
                  label="Remove goal"
                  onClick={() => removeGoal(i)}
                  disabled={goals.length <= 1}
                >
                  ×
                </IconBtn>
              </div>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={addGoal}
          disabled={goals.length >= 8}
          className="mt-2 text-xs font-medium text-[var(--color-accent)] disabled:opacity-40"
        >
          + Add goal
        </button>
      </div>

      {requireReason && (
        <div>
          <label className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
            Reason for the change (required)
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            className={`${fieldCls} mt-1`}
            placeholder="e.g. Shortened to 8 sessions and reframed goal 2 around sleep."
          />
        </div>
      )}

      {!valid && (
        <ul className="space-y-1 text-xs text-[var(--color-warn)]">
          {problems.map((p) => (
            <li key={p}>• {p}</li>
          ))}
        </ul>
      )}
      {error && <p className="text-sm text-[var(--color-warn)]">{error}</p>}

      <div className="flex gap-2">
        <Button onClick={handleSubmit} disabled={!valid || busy}>
          {busy ? 'Saving…' : 'Save and accept plan'}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function IconBtn({
  children,
  label,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="grid h-7 w-7 place-items-center rounded-lg border border-[var(--color-line-soft)] bg-white/60 text-sm text-[var(--color-ink-2)] transition-colors hover:border-[var(--color-ink-3)] disabled:opacity-30"
    >
      {children}
    </button>
  );
}
