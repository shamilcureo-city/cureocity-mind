'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
// (focus handled via the input's autoFocus on mount; no focus effect needed)
import {
  NOTE_LANGUAGES,
  noteLanguage,
  noteLanguageLabel,
  type NoteLanguage,
} from '../../lib/note-languages';

/**
 * Compact, searchable language picker for the note toolbar. Shows the
 * current language as a pill; opening it reveals a short list of common
 * languages plus a search box over the full set — so the ~38-language list
 * isn't dumped into one giant native dropdown. Selecting one triggers the
 * translation (via `onChange`).
 */

// A small, India-first shortlist shown before the therapist searches.
const COMMON_CODES = ['en', 'hi', 'ml', 'ta', 'te', 'bn', 'mr', 'ar'];

interface Props {
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
}

export function LanguagePicker({ value, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on outside-click / Escape.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent): void {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Reset the search when the popover closes.
  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const q = query.trim().toLowerCase();
  const results = useMemo<NoteLanguage[]>(() => {
    if (!q) {
      const common = COMMON_CODES.map((c) => noteLanguage(c)).filter(Boolean) as NoteLanguage[];
      // Make sure the current selection is always visible in the shortlist.
      const current = noteLanguage(value);
      if (current && !common.some((l) => l.code === current.code)) common.unshift(current);
      return common;
    }
    return NOTE_LANGUAGES.filter(
      (l) =>
        l.label.toLowerCase().includes(q) ||
        (l.native ? l.native.toLowerCase().includes(q) : false) ||
        l.code.toLowerCase() === q,
    );
  }, [q, value]);

  function pick(code: string): void {
    setOpen(false);
    if (code !== value) onChange(code);
  }

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        title="Translate the note into another language"
        className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-line)] bg-white py-1.5 pl-3 pr-3 text-sm font-medium text-[var(--color-ink)] outline-none hover:border-[var(--color-ink-3)] focus:border-[var(--color-accent)] disabled:opacity-60"
      >
        <span aria-hidden>{disabled ? '…' : '🌐'}</span>
        <span>{noteLanguageLabel(value)}</span>
        <span aria-hidden className="text-xs text-[var(--color-ink-3)]">
          ▾
        </span>
      </button>

      {open && (
        <div className="absolute left-0 z-30 mt-1.5 w-64 rounded-xl border border-[var(--color-line)] bg-white p-2 shadow-[0_12px_30px_rgba(15,27,42,0.13)]">
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search languages…"
            className="mb-1 w-full rounded-lg border border-[var(--color-line)] px-2.5 py-1.5 text-sm text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
          />
          {!q && (
            <p className="px-2.5 py-1 text-[11px] uppercase tracking-wide text-[var(--color-ink-3)]">
              Common — type to search all {NOTE_LANGUAGES.length}
            </p>
          )}
          <div className="max-h-72 overflow-y-auto">
            {results.length === 0 ? (
              <p className="px-2.5 py-2 text-sm text-[var(--color-ink-3)]">No match.</p>
            ) : (
              results.map((l) => (
                <button
                  key={l.code}
                  type="button"
                  onClick={() => pick(l.code)}
                  className={`flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-[var(--color-surface-soft)] ${
                    l.code === value
                      ? 'bg-[var(--color-accent-soft)] font-semibold text-[var(--color-accent)]'
                      : 'text-[var(--color-ink)]'
                  }`}
                >
                  <span>{l.label}</span>
                  {l.native && <span className="text-[var(--color-ink-3)]">{l.native}</span>}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
