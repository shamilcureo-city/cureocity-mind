'use client';

import { useState, type FormEvent } from 'react';
import type { RendererProps } from './types';

/**
 * CBT 5-column thought record (Beck's classic structured-form
 * archetype). Sprint 8 PR 3.
 *
 * Columns:
 *   1. Situation                   — what was happening
 *   2. Automatic thought           — what went through your mind
 *   3. Emotion + intensity 0-100   — what did you feel
 *   4. Evidence for / against      — what supports / challenges the thought
 *   5. Balanced thought            — a fairer alternative
 *
 * Response payload shape (validated server-side against the catalog's
 * thought_record schema in Sprint 9):
 *   {
 *     situation: string,
 *     automaticThought: string,
 *     emotion: string,
 *     emotionIntensity: number,    // 0..100
 *     evidenceFor: string,
 *     evidenceAgainst: string,
 *     balancedThought: string,
 *   }
 */
export function ThoughtRecordForm({ exerciseTitle, description, onSubmit, busy }: RendererProps) {
  const [situation, setSituation] = useState('');
  const [automaticThought, setAutomaticThought] = useState('');
  const [emotion, setEmotion] = useState('');
  const [intensity, setIntensity] = useState(50);
  const [evidenceFor, setEvidenceFor] = useState('');
  const [evidenceAgainst, setEvidenceAgainst] = useState('');
  const [balancedThought, setBalancedThought] = useState('');

  const ready =
    situation.trim() && automaticThought.trim() && emotion.trim() && balancedThought.trim();

  function handle(e: FormEvent): void {
    e.preventDefault();
    if (!ready) return;
    void onSubmit({
      situation: situation.trim(),
      automaticThought: automaticThought.trim(),
      emotion: emotion.trim(),
      emotionIntensity: intensity,
      evidenceFor: evidenceFor.trim(),
      evidenceAgainst: evidenceAgainst.trim(),
      balancedThought: balancedThought.trim(),
    });
  }

  return (
    <form onSubmit={handle} className="space-y-5">
      <header>
        <h2 className="text-lg font-semibold text-[var(--color-navy-700)]">{exerciseTitle}</h2>
        <p className="mt-1 text-sm text-[var(--color-slate-500)]">{description}</p>
      </header>

      <Field
        label="1. Situation"
        helper="Where were you, who was around, what was happening?"
        rows={3}
        value={situation}
        onChange={setSituation}
      />
      <Field
        label="2. Automatic thought"
        helper="What went through your mind in that moment?"
        rows={3}
        value={automaticThought}
        onChange={setAutomaticThought}
      />

      <div>
        <label className="block text-sm font-medium">3. Emotion</label>
        <input
          type="text"
          value={emotion}
          onChange={(e) => setEmotion(e.target.value)}
          placeholder="e.g. anxious, ashamed, angry"
          className="mt-1 w-full rounded-md border border-[var(--color-slate-200)] bg-white px-3 py-2 text-sm focus:border-[var(--color-navy-500)] focus:outline-none"
        />
        <label className="mt-3 block">
          <span className="flex items-baseline justify-between text-sm">
            <span>Intensity 0–100</span>
            <span className="text-lg font-semibold tabular-nums">{intensity}</span>
          </span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={intensity}
            onChange={(e) => setIntensity(Number(e.target.value))}
            className="mt-1 w-full"
          />
        </label>
      </div>

      <Field
        label="4a. Evidence supporting the thought"
        rows={3}
        value={evidenceFor}
        onChange={setEvidenceFor}
      />
      <Field
        label="4b. Evidence against the thought"
        rows={3}
        value={evidenceAgainst}
        onChange={setEvidenceAgainst}
      />

      <Field
        label="5. Balanced thought"
        helper="Taking the evidence into account, what's a fairer way to see this?"
        rows={3}
        value={balancedThought}
        onChange={setBalancedThought}
      />

      <button
        type="submit"
        disabled={busy || !ready}
        className="w-full rounded-md bg-[var(--color-navy-700)] px-4 py-3 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? 'Saving…' : 'Save thought record'}
      </button>
    </form>
  );
}

function Field(props: {
  label: string;
  helper?: string;
  rows: number;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="font-medium">{props.label}</span>
      {props.helper && (
        <span className="mt-0.5 block text-xs text-[var(--color-slate-500)]">{props.helper}</span>
      )}
      <textarea
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        rows={props.rows}
        className="mt-1 w-full rounded-md border border-[var(--color-slate-200)] bg-white px-3 py-2 text-sm focus:border-[var(--color-navy-500)] focus:outline-none"
      />
    </label>
  );
}
