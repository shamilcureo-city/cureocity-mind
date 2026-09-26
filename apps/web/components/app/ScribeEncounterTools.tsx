'use client';

import { useState } from 'react';
import { ScribeReportsPanel } from './ScribeReportsPanel';
import { ScribePatientInstructions } from './ScribePatientInstructions';
import { ScribePendingWorkPanel } from './ScribePendingWorkPanel';
import { ScribeConsultationDocumentsWorkspace } from './ScribeConsultationDocumentsWorkspace';

/** Supporting work stays collapsed until needed; it never interrupts capture or signs a note. */
export function ScribeEncounterTools({
  clientId,
  sessionId,
  signed,
}: {
  clientId: string;
  sessionId: string;
  signed: boolean;
}) {
  const [open, setOpen] = useState<'reports' | 'tasks' | 'instructions' | 'documents' | null>(null);
  const [documentsOpened, setDocumentsOpened] = useState(false);
  const options = [
    { key: 'reports', label: 'Reports' },
    { key: 'tasks', label: 'Follow-up tasks' },
    { key: 'instructions', label: 'Patient instructions' },
    { key: 'documents', label: 'Consultation documents' },
  ] as const;
  return (
    <section
      aria-label="Supporting consultation tools"
      className="space-y-3 rounded-xl border border-[var(--color-line)] bg-white p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-2 text-sm font-semibold">Consultation tools</span>
        {options.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            aria-expanded={open === key}
            aria-controls={`scribe-${sessionId}-${key}`}
            onClick={() => {
              if (key === 'documents') setDocumentsOpened(true);
              setOpen(open === key ? null : key);
            }}
            className={`min-h-11 rounded-lg border px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 ${open === key ? 'border-[var(--color-ink)] bg-[var(--color-accent-soft)]' : 'border-[var(--color-line)] bg-white'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {documentsOpened && (
        <div id={`scribe-${sessionId}-documents`} hidden={open !== 'documents'}>
          <ScribeConsultationDocumentsWorkspace
            key={`${clientId}:${sessionId}`}
            clientId={clientId}
            sessionId={sessionId}
          />
        </div>
      )}
      {open === 'reports' && (
        <div id={`scribe-${sessionId}-reports`}>
          <ScribeReportsPanel clientId={clientId} sessionId={sessionId} />
        </div>
      )}
      {open === 'tasks' && (
        <div id={`scribe-${sessionId}-tasks`}>
          <ScribePendingWorkPanel clientId={clientId} />
        </div>
      )}
      {open === 'instructions' && (
        <div id={`scribe-${sessionId}-instructions`}>
          {signed ? (
            <ScribePatientInstructions clientId={clientId} sessionId={sessionId} />
          ) : (
            <p className="text-sm text-[var(--color-ink-2)]">
              Review and sign the current note and prescription first. Patient instructions are
              prepared from that signed source, then checked by you before download.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
