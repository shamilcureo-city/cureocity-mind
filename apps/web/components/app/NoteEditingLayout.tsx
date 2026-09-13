'use client';

import { useId, useState, type ReactNode } from 'react';
import { Button } from '../ui/Button';

/** Keep source evidence beside corrections on a wide screen; one optional pane on phones. */
export function NoteEditingLayout({
  children,
  reference,
  mode = 'edit',
}: {
  children: ReactNode;
  reference: ReactNode;
  mode?: 'edit' | 'review';
}) {
  const [shown, setShown] = useState(false);
  const id = useId();
  return (
    <section className="space-y-4">
      <Button
        variant="secondary"
        className="print:hidden"
        aria-expanded={shown}
        aria-controls={id}
        onClick={() => setShown((value) => !value)}
      >
        {shown
          ? 'Hide transcript reference'
          : mode === 'review'
            ? 'Compare with transcript'
            : 'Show transcript reference'}
      </Button>
      <div
        className={
          shown
            ? 'grid items-start gap-6 print:block xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]'
            : ''
        }
      >
        <div className="min-w-0">{children}</div>
        {shown && (
          <aside
            id={id}
            aria-label="Transcript reference"
            className="order-first min-w-0 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-4 print:hidden xl:sticky xl:top-4 xl:order-last"
          >
            <p className="mb-3 text-sm font-semibold">
              {mode === 'review'
                ? 'Check the source while reviewing your note'
                : 'Check the transcript without leaving this edit'}
            </p>
            <div
              tabIndex={0}
              role="region"
              aria-label="Scrollable saved transcript"
              className="max-h-64 overflow-y-auto rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] xl:max-h-[70vh]"
            >
              {reference}
            </div>
          </aside>
        )}
      </div>
    </section>
  );
}
