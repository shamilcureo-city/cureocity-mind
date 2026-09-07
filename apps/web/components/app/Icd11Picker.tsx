'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { icd11Block, searchIcd11, type Icd11Entry } from '@cureocity/clinical';

/** Catalogue search and an explicitly confirmed custom code are separate states.
 * Unselected search text stays visible on blur and cannot retain an older code. */
export function Icd11Picker({
  code,
  onPick,
  onCodeChange,
  disabled,
  inputClassName,
  inputStyle,
}: {
  code: string;
  onPick: (entry: Icd11Entry) => void;
  /** Called to clear an old selection, or to commit a confirmed custom code. */
  onCodeChange: (code: string) => void;
  disabled?: boolean;
  inputClassName?: string;
  inputStyle?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [dirty, setDirty] = useState(false);
  const [customSelected, setCustomSelected] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const id = useId();
  const listId = id + '-listbox';
  const statusId = id + '-status';
  const results = useMemo(() => searchIcd11(dirty ? query : code, 60), [dirty, query, code]);
  const candidate = query.trim();
  const customAvailable =
    dirty &&
    candidate.length > 0 &&
    !results.some((entry) => entry.code.toLowerCase() === candidate.toLowerCase());
  const showResults = open && results.length > 0;

  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.children[active];
    if (el instanceof HTMLElement) el.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  function choose(entry: Icd11Entry): void {
    onPick(entry);
    setOpen(false);
    setQuery('');
    setDirty(false);
    setCustomSelected(false);
  }
  function chooseCustom(): void {
    if (!customAvailable || disabled) return;
    onCodeChange(candidate);
    setQuery('');
    setDirty(false);
    setCustomSelected(true);
    setOpen(false);
  }
  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(0);
        return;
      }
      if (!results.length) return;
      setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length);
    } else if (e.key === 'Enter' && open) {
      // Never let an unfinished search submit the surrounding diagnosis form.
      e.preventDefault();
      if (results[active]) choose(results[active]);
      else if (customAvailable) chooseCustom();
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  }

  return (
    <div
      className="relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <input
        value={dirty ? query : code}
        onChange={(event) => {
          setQuery(event.target.value);
          setDirty(true);
          setCustomSelected(false);
          setActive(0);
          setOpen(true);
          // A partial search is not a selected code. Clear the previous selection
          // so the form cannot accidentally submit it while displaying new text.
          if (code) onCodeChange('');
        }}
        onFocus={() => {
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        disabled={disabled}
        role="combobox"
        aria-label="ICD-11 code"
        aria-expanded={showResults}
        aria-controls={showResults ? listId : undefined}
        aria-activedescendant={open && results[active] ? id + '-option-' + active : undefined}
        aria-describedby={statusId}
        aria-autocomplete="list"
        placeholder="Search code or name…"
        className={inputClassName}
        style={inputStyle}
      />
      {showResults && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="ICD-11 catalogue results"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-lg border bg-white py-1 shadow-lg"
          style={{ borderColor: 'var(--color-line)' }}
        >
          {results.map((entry, i) => (
            <li
              key={entry.code}
              id={id + '-option-' + i}
              role="option"
              aria-selected={i === active}
              onMouseDown={(event) => {
                event.preventDefault();
                choose(entry);
              }}
              onMouseEnter={() => setActive(i)}
              className="cursor-pointer px-3 py-1.5 text-[12.5px]"
              style={i === active ? { background: 'var(--color-accent-soft)' } : undefined}
            >
              <span className="font-mono font-semibold text-[var(--color-accent)]">
                {entry.code}
              </span>{' '}
              <span className="text-[var(--color-ink-2)]">{entry.label}</span>
              <span className="block text-[10.5px] text-[var(--color-ink-3)]">
                {icd11Block(entry.code)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div id={statusId} className="mt-1 text-[12px] text-[var(--color-ink-3)]">
        {dirty && candidate && (
          <p role="status">
            {results.length === 0 ? 'No match in this catalogue. ' : ''}
            No code selected.{' '}
            {customAvailable
              ? 'Use this code to confirm your entry, or choose a catalogue result.'
              : 'Choose the catalogue result to confirm it.'}
          </p>
        )}
        {customSelected && code && (
          <p role="status">
            Custom code selected. Confirm its accuracy and enter the diagnosis label.
          </p>
        )}
        {customAvailable && (
          <button
            type="button"
            disabled={disabled}
            onClick={chooseCustom}
            className="mt-1 rounded border px-2 py-1 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            Use this code: {candidate}
          </button>
        )}
      </div>
    </div>
  );
}
