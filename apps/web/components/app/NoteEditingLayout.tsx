'use client';

import { useId, useState, type ReactNode } from 'react';
import { Button } from '../ui/Button';

/** Keep source evidence beside corrections on a wide screen; one optional pane on phones. */
export function NoteEditingLayout({
  children,
  reference,
}: {
  children: ReactNode;
  reference: ReactNode;
}) {
  const [shown, setShown] = useState(false);
  const id = useId();
  return (
    <section className="space-y-4">
      <Button
        variant="secondary"
        aria-expanded={shown}
        aria-controls={id}
        onClick={() => setShown((value) => !value)}
      >
        {shown ? 'Hide transcript reference' : 'Show transcript reference'}
      </Button>
      <div
        className={shown ? 'grid items-start gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]' : ''}
      >
        <div className="min-w-0">{children}</div>
        {shown && (
          <aside
            id={id}
            aria-label="Transcript reference"
            className="order-first min-w-0 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-4 xl:sticky xl:top-4 xl:order-last"
          >
            <p className="mb-3 text-sm font-semibold">
              Check the transcript without leaving this edit
            </p>
            <div className="max-h-64 overflow-y-auto xl:max-h-[70vh]">{reference}</div>
          </aside>
        )}
      </div>
    </section>
  );
}
