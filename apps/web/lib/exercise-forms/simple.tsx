'use client';

import { useState, type FormEvent } from 'react';
import type { RendererProps } from './types';

/**
 * Three lightweight renderers for the simpler response archetypes.
 *
 * MoodSliderForm     — responseSchema: 'mood_rating_0_10'
 * FreeTextForm       — responseSchema: 'free_text' (and questionnaires until Sprint 9)
 * ExposureLogForm    — responseSchema: 'exposure_log'
 */

export function MoodSliderForm({ exerciseTitle, description, onSubmit, busy }: RendererProps) {
  const [rating, setRating] = useState(5);
  const [notes, setNotes] = useState('');

  function handle(e: FormEvent): void {
    e.preventDefault();
    void onSubmit({ rating }, notes.trim() || undefined);
  }

  return (
    <form onSubmit={handle} className="space-y-5">
      <header>
        <h2 className="text-lg font-semibold text-[var(--color-navy-700)]">{exerciseTitle}</h2>
        <p className="mt-1 text-sm text-[var(--color-slate-500)]">{description}</p>
      </header>

      <label className="block">
        <span className="flex items-baseline justify-between text-sm">
          <span>How was it overall? 0–10</span>
          <span className="text-2xl font-semibold tabular-nums">{rating}</span>
        </span>
        <input
          type="range"
          min={0}
          max={10}
          step={1}
          value={rating}
          onChange={(e) => setRating(Number(e.target.value))}
          className="mt-2 w-full"
        />
      </label>

      <label className="block text-sm">
        Notes (optional)
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          maxLength={1000}
          className="mt-1 w-full rounded-md border border-[var(--color-slate-200)] bg-white px-3 py-2 text-sm focus:border-[var(--color-navy-500)] focus:outline-none"
        />
      </label>

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-md bg-[var(--color-navy-700)] px-4 py-3 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? 'Saving…' : 'Save'}
      </button>
    </form>
  );
}

export function FreeTextForm({ exerciseTitle, description, onSubmit, busy }: RendererProps) {
  const [text, setText] = useState('');

  function handle(e: FormEvent): void {
    e.preventDefault();
    if (!text.trim()) return;
    void onSubmit({ text: text.trim() });
  }

  return (
    <form onSubmit={handle} className="space-y-5">
      <header>
        <h2 className="text-lg font-semibold text-[var(--color-navy-700)]">{exerciseTitle}</h2>
        <p className="mt-1 text-sm text-[var(--color-slate-500)]">{description}</p>
      </header>

      <label className="block text-sm">
        Your response
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          maxLength={10_000}
          className="mt-1 w-full rounded-md border border-[var(--color-slate-200)] bg-white px-3 py-2 text-sm focus:border-[var(--color-navy-500)] focus:outline-none"
        />
      </label>

      <button
        type="submit"
        disabled={busy || !text.trim()}
        className="w-full rounded-md bg-[var(--color-navy-700)] px-4 py-3 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? 'Saving…' : 'Save'}
      </button>
    </form>
  );
}

interface ExposureRow {
  description: string;
  preSuds: number;
  postSuds: number;
}

export function ExposureLogForm({ exerciseTitle, description, onSubmit, busy }: RendererProps) {
  const [rows, setRows] = useState<ExposureRow[]>([{ description: '', preSuds: 50, postSuds: 50 }]);

  function setRow(i: number, patch: Partial<ExposureRow>): void {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function addRow(): void {
    setRows((prev) => [...prev, { description: '', preSuds: 50, postSuds: 50 }]);
  }

  function handle(e: FormEvent): void {
    e.preventDefault();
    const cleaned = rows.filter((r) => r.description.trim());
    if (cleaned.length === 0) return;
    void onSubmit({ exposures: cleaned });
  }

  return (
    <form onSubmit={handle} className="space-y-5">
      <header>
        <h2 className="text-lg font-semibold text-[var(--color-navy-700)]">{exerciseTitle}</h2>
        <p className="mt-1 text-sm text-[var(--color-slate-500)]">{description}</p>
      </header>

      {rows.map((row, i) => (
        <div key={i} className="rounded-md border border-[var(--color-slate-200)] bg-white p-4">
          <label className="block text-sm">
            What did you face?
            <input
              type="text"
              value={row.description}
              onChange={(e) => setRow(i, { description: e.target.value })}
              className="mt-1 w-full rounded-md border border-[var(--color-slate-200)] bg-white px-3 py-2 text-sm focus:border-[var(--color-navy-500)] focus:outline-none"
            />
          </label>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="block text-xs">
              SUDS before
              <input
                type="number"
                min={0}
                max={100}
                value={row.preSuds}
                onChange={(e) => setRow(i, { preSuds: Number(e.target.value) })}
                className="mt-1 w-full rounded-md border border-[var(--color-slate-200)] bg-white px-2 py-1 text-sm"
              />
            </label>
            <label className="block text-xs">
              SUDS after
              <input
                type="number"
                min={0}
                max={100}
                value={row.postSuds}
                onChange={(e) => setRow(i, { postSuds: Number(e.target.value) })}
                className="mt-1 w-full rounded-md border border-[var(--color-slate-200)] bg-white px-2 py-1 text-sm"
              />
            </label>
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={addRow}
        className="w-full rounded-md border border-[var(--color-slate-200)] bg-white px-4 py-2 text-sm font-medium"
      >
        + Add another exposure
      </button>

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-md bg-[var(--color-navy-700)] px-4 py-3 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? 'Saving…' : 'Save log'}
      </button>
    </form>
  );
}
