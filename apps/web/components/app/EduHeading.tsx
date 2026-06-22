'use client';

import { useId, useState, type ReactNode } from 'react';
import {
  CLINICAL_GLOSSARY,
  type GlossaryEntry,
  type GlossaryKey,
} from '../../lib/clinical-glossary';

/**
 * Sprint 58 — the plain-language education layer.
 *
 * Our pilot therapists are often new to software and to the clinical
 * shorthand the app uses (SOAP, MSE, ICD-11…). These components make
 * every clinical label friendly: a plain-English title is what the user
 * reads first, the real clinical term sits small underneath (so they
 * still learn it), and a calm, optional "What's this?" teaches the rest.
 *
 * Tap-first (not hover-only) so it works on a phone. The explainer is
 * collapsed by default, so it never clutters the screen — it is there
 * for the moment someone wonders, and invisible otherwise. The reveal
 * panel always renders full-width under its heading so the text stays
 * readable regardless of how narrow the trigger is.
 */

/** The reveal panel: plain "what / why / example", read full-width. */
function ExplainerPanel({ entry, id }: { entry: GlossaryEntry; id?: string }) {
  return (
    <div
      id={id}
      role="note"
      className="mt-2 rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] px-3.5 py-3 text-[13px] leading-relaxed text-[var(--color-ink-2)]"
    >
      <p className="text-[var(--color-ink)]">{entry.what}</p>
      {entry.why && (
        <p className="mt-2">
          <span className="font-medium text-[var(--color-ink)]">Why it helps · </span>
          {entry.why}
        </p>
      )}
      {entry.example && (
        <p className="mt-2 italic text-[var(--color-ink-3)]">For example: {entry.example}</p>
      )}
    </div>
  );
}

/** The little "What's this?" toggle button. */
function ToggleButton({
  open,
  onClick,
  controls,
}: {
  open: boolean;
  onClick: () => void;
  controls?: string;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={open ? controls : undefined}
      onClick={onClick}
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--color-line)] bg-white px-2 py-0.5 text-[11px] font-medium text-[var(--color-ink-3)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
    >
      <span aria-hidden>{open ? '×' : 'ⓘ'}</span>
      {open ? 'Close' : "What's this?"}
    </button>
  );
}

/**
 * `<section>` wrapper = friendly heading (plain title + small clinical
 * term + "What's this?") and the body. Drop-in replacement for the old
 * bare-heading `Section` helpers in the note previews.
 */
export function EduSection({ term, children }: { term: GlossaryKey; children: ReactNode }) {
  const entry = CLINICAL_GLOSSARY[term];
  const [open, setOpen] = useState(false);
  const id = useId();
  const panelId = `edu-${id}`;
  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1.5">
        <div>
          <h3 className="font-serif text-xl leading-tight text-[var(--color-ink)]">
            {entry.plainTitle}
          </h3>
          {entry.term && (
            <p className="mt-0.5 text-xs uppercase tracking-wider text-[var(--color-ink-3)]">
              {entry.term}
            </p>
          )}
        </div>
        <ToggleButton open={open} onClick={() => setOpen((v) => !v)} controls={panelId} />
      </div>
      {open && <ExplainerPanel entry={entry} id={panelId} />}
      <div className="mt-2.5 text-[15px] leading-relaxed text-[var(--color-ink)]">{children}</div>
    </section>
  );
}

/**
 * A standalone explainer — a short label + a "What's this?" toggle, with
 * the reveal panel full-width below. For spots that aren't a note section
 * (e.g. a footer label, or "what does sign-off mean?").
 */
export function InlineExplainer({ entry, label }: { entry: GlossaryEntry; label?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const panelId = `edu-inline-${id}`;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {label && <span className="text-xs text-[var(--color-ink-3)]">{label}</span>}
        <ToggleButton open={open} onClick={() => setOpen((v) => !v)} controls={panelId} />
      </div>
      {open && <ExplainerPanel entry={entry} id={panelId} />}
    </div>
  );
}

/**
 * A soft, reassuring callout — for empty states and "here's what's about
 * to happen" moments. Keeps the tone calm and the user feeling capable.
 */
export function HelpNote({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] px-4 py-3 text-left">
      {title && (
        <p className="flex items-center gap-1.5 text-sm font-medium text-[var(--color-ink)]">
          <span aria-hidden>💡</span>
          {title}
        </p>
      )}
      <div className="mt-1 text-[13px] leading-relaxed text-[var(--color-ink-2)]">{children}</div>
    </div>
  );
}
