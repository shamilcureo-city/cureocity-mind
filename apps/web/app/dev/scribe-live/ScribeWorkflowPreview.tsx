'use client';

import { useState } from 'react';
import { ScribeTransportProvider } from '@/components/app/ScribeTransport';
import { ScribeBriefingCard } from '@/components/app/ScribeBriefingCard';
import { ScribeIntakePanel } from '@/components/app/ScribeIntakePanel';
import { ScribePendingWorkPanel } from '@/components/app/ScribePendingWorkPanel';
import { ScribeReportsPanel } from '@/components/app/ScribeReportsPanel';
import { ScribePatientInstructions } from '@/components/app/ScribePatientInstructions';
import { MedicalNoteEditor } from '@/components/app/MedicalNoteEditor';
import { MedicalNoteView } from '@/components/app/MedicalNoteView';
import { PlanComposer } from '@/components/app/PlanComposer';
import { Button } from '@/components/ui/Button';
import {
  createScribeWorkflowFixture,
  PREVIEW_CLIENT,
  PREVIEW_SESSION,
  WORKFLOW_PREVIEW_NOTE,
} from './scribe-workflow-fixture';

export function ScribeWorkflowPreview() {
  const [fetcher] = useState(() => createScribeWorkflowFixture());
  const [stage, setStage] = useState('prepare');
  const [note, setNote] = useState(WORKFLOW_PREVIEW_NOTE);
  const [editing, setEditing] = useState(false);
  return (
    <ScribeTransportProvider fetcher={fetcher}>
      <div className="space-y-5">
        <p
          role="status"
          className="rounded-xl border border-[#b7c5dc] bg-[#f2f6fc] p-4 text-sm text-[#304c80]"
        >
          Fictional workflow preview. Changes stay in memory and reset on reload. No recording,
          database writes, AI processing or patient messages.
        </p>
        <nav aria-label="Doctor workflow preview" className="flex flex-wrap gap-2">
          {[
            ['prepare', 'Prepare'],
            ['review', 'Note & prescription'],
            ['reports', 'Report review'],
            ['handoff', 'Patient handoff'],
          ].map(([key, label]) => (
            <Button
              key={key}
              variant={stage === key ? 'primary' : 'secondary'}
              onClick={() => setStage(key!)}
              aria-pressed={stage === key}
            >
              {label}
            </Button>
          ))}
        </nav>
        {stage === 'prepare' && (
          <div className="grid items-start gap-5 lg:grid-cols-2">
            <div className="space-y-5">
              <ScribeBriefingCard clientId={PREVIEW_CLIENT} />
              <ScribeIntakePanel clientId={PREVIEW_CLIENT} />
            </div>
            <ScribePendingWorkPanel clientId={PREVIEW_CLIENT} />
          </div>
        )}
        {stage === 'review' && (
          <div className="grid items-start gap-5 lg:grid-cols-2">
            <section
              className="space-y-4 rounded-xl border border-[var(--color-line)] bg-white p-5"
              aria-label="Fictional note review"
            >
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">Review the note</h2>
                {!editing && (
                  <Button variant="secondary" onClick={() => setEditing(true)}>
                    Edit note
                  </Button>
                )}
              </div>
              {editing ? (
                <MedicalNoteEditor
                  note={note}
                  baseline={WORKFLOW_PREVIEW_NOTE}
                  onCancel={() => setEditing(false)}
                  onSave={(next) => {
                    setNote(next);
                    setEditing(false);
                  }}
                />
              ) : (
                <MedicalNoteView note={note} />
              )}
            </section>
            <PlanComposer
              sessionId={PREVIEW_SESSION}
              signed={false}
              copilotActive={false}
              voiceEditingEnabled={false}
            />
          </div>
        )}
        {stage === 'reports' && (
          <ScribeReportsPanel clientId={PREVIEW_CLIENT} sessionId={PREVIEW_SESSION} />
        )}
        {stage === 'handoff' && (
          <>
            <p className="text-sm text-[var(--color-ink-2)]">
              This example represents a previously signed fictional encounter. Real instructions
              require the current signed note and prescription.
            </p>
            <ScribePatientInstructions sessionId={PREVIEW_SESSION} clientId={PREVIEW_CLIENT} />
          </>
        )}
      </div>
    </ScribeTransportProvider>
  );
}
