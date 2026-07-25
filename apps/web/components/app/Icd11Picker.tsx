'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { icd11Block, searchIcd11, type Icd11Entry } from '@cureocity/clinical';

/**
 * ICD-11 code picker — PC5.
 *
 * A searchable combobox rather than a plain <select>: the catalogue is a few
 * hundred entries, which is far past the point where scrolling a native
 * dropdown beats typing. Typing filters on both code and label ("6b0", "panic",
 * "dep mod"), and picking an entry fills the code AND its WHO title in one go,
 * so the two fields can't drift apart.
 *
 * Free text is deliberately still allowed. The catalogue is a curated subset of
 * Chapter 06 (see packages/clinical/src/icd11.ts) — a therapist needing a finer
 * child code must not be blocked by our list, so anything typed is kept and the
 * UI just notes that it is outside the catalogue.
 */
export function Icd11Picker({
  code,
  onPick,
  onCodeChange,
  disabled,
  inputClassName,
  inputStyle,
}: {
  code: string;
  /** Fired when an entry is chosen — carries the label so the caller can sync it. */
  onPick: (entry: Icd11Entry) => void;
  /** Fired on raw typing, for codes outside the catalogue. */
  onCodeChange: (code: string) => void;
  disabled?: boolean;
  inputClassName?: string;
  inputStyle?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // While the menu is open the input shows the query; closed, it shows the code.
  const results = useMemo(() => searchIcd11(open ? query : code, 60), [open, query, code]);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent): void {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  // Keep the highlighted row in view when arrowing past the visible window.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.children[active];
    if (el instanceof HTMLElement) el.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  function choose(entry: Icd11Entry): void {
    onPick(entry);
    setOpen(false);
    setQuery('');
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(0);
        return;
      }
      setActive((i) => {
        const next = e.key === 'ArrowDown' ? i + 1 : i - 1;
        if (next < 0) return results.length - 1;
        if (next >= results.length) return 0;
        return next;
      });
      return;
    }
    if (e.key === 'Enter' && open && results[active]) {
      e.preventDefault();
      choose(results[active]);
      return;
    }
    if (e.key === 'Escape' && open) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      setQuery('');
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <input
        value={open ? query : code}
        onChange={(e) => {
          const v = e.target.value;
          if (open) {
            setQuery(v);
            setActive(0);
          } else {
            onCodeChange(v);
          }
        }}
        onFocus={() => {
          setQuery('');
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        disabled={disabled}
        role="combobox"
        aria-expanded={open}
        aria-controls="icd11-listbox"
        aria-autocomplete="list"
        placeholder={open ? 'Search code or name…' : '6A70.1'}
        className={inputClassName}
        style={inputStyle}
      />

      {open && (
        <ul
          ref={listRef}
          id="icd11-listbox"
          role="listbox"
          className="absolute left-0 right-0 z-30 mt-1 max-h-64 overflow-y-auto rounded-lg border bg-white py-1 shadow-lg"
          style={{ borderColor: 'var(--color-line)' }}
        >
          {results.length === 0 ? (
            <li className="px-3 py-2 text-[12px] text-[var(--color-ink-3)]">
              No match in the catalogue — you can still type the code by hand.
            </li>
          ) : (
            results.map((entry, i) => (
              <li
                key={entry.code}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
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
                {/* The block keeps a 418-entry catalogue orientable: with many
                    near-identical substance labels, the heading is often the
                    only thing distinguishing two rows at a glance. */}
                <span className="block text-[10.5px] text-[var(--color-ink-3)]">
                  {icd11Block(entry.code)}
                </span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
