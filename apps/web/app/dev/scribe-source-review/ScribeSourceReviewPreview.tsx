'use client';

import { useState } from 'react';
import { MedicalEncounterNoteV1Schema, type MedicalEvidenceField } from '@cureocity/contracts';
import { ScribeSourceComparison } from '@/components/app/ScribeSourceComparison';
import { MedicalNoteView } from '@/components/app/MedicalNoteView';
import { MedicalNoteEditor } from '@/components/app/MedicalNoteEditor';
import { ScribeTransportProvider } from '@/components/app/ScribeTransport';
import { Button } from '@/components/ui/Button';
import type { ScribeSourceSnapshot } from '@/lib/scribe-source-review';
import { createScribeWorkflowFixture } from '../scribe-live/scribe-workflow-fixture';

const baseline = MedicalEncounterNoteV1Schema.parse({
  version: 'V1',
  encounterKind: 'FOLLOW_UP',
  chiefComplaint: 'Tiredness for two weeks.',
  hpi: 'Sleep has improved. Energy has returned to normal.',
  reviewOfSystems: ['No fever reported.'],
  vitals: { heartRateBpm: 76 },
  assessment: 'Fictional assessment to be completed by the doctor.',
  plan: 'Bring earlier reports to the follow-up.',
  linkedEvidence: [
    { field: 'chiefComplaint', quote: 'I have felt tired for two weeks.' },
    { field: 'hpi', quote: 'I sleep seven hours most nights.' },
    {
      field: 'hpi',
      quote: 'My energy is back to normal.',
      claim: 'Energy has returned to normal.',
    },
    { field: 'reviewOfSystems', quote: 'No fever.' },
    { field: 'vitals', quote: 'Your heart rate is 76.' },
    { field: 'plan', quote: 'Bring the earlier reports when we meet again.' },
  ],
});
const transcript = [
  'Doctor: What would you like us to discuss today?',
  'Patient: I have felt tired for two weeks.',
  'Doctor: How has your sleep been?',
  'Patient: I sleep seven hours most nights. I still feel tired in the afternoon.',
  'Doctor: Have you had a fever?',
  'Patient: No fever.',
  'Doctor: Your heart rate is 76. We will review the history together.',
  'Doctor: Bring the earlier reports when we meet again.',
].join('\n\n');
const original: ScribeSourceSnapshot = {
  draftId: 'fictional-source-draft',
  version: 'a'.repeat(64),
  draftContent: baseline,
  transcript,
  sourceState: 'available',
  sourceMessage: null,
};

/** Actual comparison/editor with a fictional transport; no clinical endpoints or media. */
export function ScribeSourceReviewPreview() {
  const [fetcher] = useState(() => createScribeWorkflowFixture());
  const [note, setNote] = useState(baseline);
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(true);
  const [field, setField] = useState<MedicalEvidenceField>('hpi');
  const [focusRequest, setFocusRequest] = useState(0);
  const [source, setSource] = useState(original);
  return (
    <ScribeTransportProvider fetcher={fetcher}>
      <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-8">
        <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-serif text-3xl">Review the note with its source</h1>
            <p className="mt-2 text-sm text-[var(--color-ink-2)]">
              Ananya Rao · fictional follow-up
            </p>
          </div>
          <p className="text-sm text-[var(--color-ink-2)]">Cureocity Scribe · local preview</p>
        </header>
        <p
          role="status"
          className="mb-5 rounded-xl border border-[var(--color-line)] bg-white p-4 text-sm leading-6"
        >
          Fictional data, including one intentionally missing quotation. Changes stay in this page;
          no patient record, recording, AI request or signature is created.
        </p>
        <nav className="mb-5 flex flex-wrap gap-2" aria-label="Source preview scenarios">
          <Button variant="secondary" onClick={() => setSource(original)}>
            Original source
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              setSource({
                ...original,
                transcript: null,
                sourceState: 'unavailable',
                sourceMessage:
                  'The saved transcript could not be opened. Retry loading the source.',
              })
            }
          >
            Unavailable source
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              setSource({
                ...original,
                version: 'b'.repeat(64),
                draftContent: { ...baseline, hpi: 'A newer saved draft exists.' },
              })
            }
          >
            Changed saved draft
          </Button>
        </nav>
        <section className="rounded-2xl border border-[var(--color-line)] bg-white p-4 sm:p-6">
          {!open && (
            <Button
              variant="secondary"
              onClick={() => {
                setOpen(true);
                setFocusRequest((value) => value + 1);
              }}
            >
              Compare with source
            </Button>
          )}
          <ScribeSourceComparison
            open={open}
            editing={editing}
            note={note}
            baseline={baseline}
            source={source}
            loading={false}
            error={null}
            onRetry={() => setSource(original)}
            onClose={() => setOpen(false)}
            activeField={field}
            onSelectField={setField}
            focusRequest={focusRequest}
          >
            <div className="mb-5 flex items-center justify-between gap-3">
              <h2 className="font-serif text-2xl">Clinical note</h2>
              {!editing && (
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  Edit note
                </Button>
              )}
            </div>
            {editing ? (
              <MedicalNoteEditor
                note={note}
                baseline={baseline}
                onFieldFocus={setField}
                onCancel={() => setEditing(false)}
                onSave={(next) => {
                  setNote(next);
                  setEditing(false);
                }}
              />
            ) : (
              <MedicalNoteView
                note={note}
                baseline={baseline}
                onReviewSource={(next) => {
                  setField(next);
                  setOpen(true);
                  setFocusRequest((value) => value + 1);
                }}
              />
            )}
          </ScribeSourceComparison>
        </section>
      </main>
    </ScribeTransportProvider>
  );
}
