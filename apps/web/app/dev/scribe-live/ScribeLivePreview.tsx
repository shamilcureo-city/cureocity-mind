'use client';

import { useRef, useState } from 'react';
import type { Utterance } from '@cureocity/contracts';
import {
  TranscriptPanel,
  NotePanel,
  RxPadPanel,
  DifferentialZone,
} from '@/components/app/DoctorLiveEncounter';
import {
  ScribeLiveWorkspace,
  ScribeInputMeter,
  scribeLiveStyles as styles,
} from '@/components/app/ScribeLiveWorkspace';
import { Button } from '@/components/ui/Button';

const utterances: Utterance[] = [
  {
    id: 'preview-1',
    speaker: 'doctor',
    tStartMs: 0,
    tEndMs: 4000,
    text: 'What would you like to discuss today?',
  },
  {
    id: 'preview-2',
    speaker: 'patient',
    tStartMs: 4000,
    tEndMs: 10000,
    text: 'I have felt more tired over the past two weeks. My sleep has been irregular.',
  },
  {
    id: 'preview-3',
    speaker: 'doctor',
    tStartMs: 10000,
    tEndMs: 16000,
    text: 'Tell me about your sleep, and any other changes you have noticed.',
  },
  {
    id: 'preview-4',
    speaker: 'patient',
    tStartMs: 16000,
    tEndMs: 22000,
    text: 'I have been working late. I brought my previous reports for us to review.',
  },
];

/** Presentational components only: no microphone, model, socket, account or database. */
export function ScribeLivePreview() {
  const refs = useRef(new Map<string, HTMLDivElement | null>());
  const [paused, setPaused] = useState(false);
  return (
    <main className={`${styles.surface} min-h-screen bg-[var(--color-bg)] px-4 py-6 sm:px-8`}>
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-semibold">Cureocity Scribe</h1>
          <p className="text-sm text-[var(--color-ink-2)]">
            Fictional local preview · microphone off
          </p>
        </header>
        <div className={styles.captureBar}>
          <div>
            <p className="font-semibold">
              Ananya Rao <span className="font-normal">· 42</span>
            </p>
            <p className="text-sm text-[var(--color-ink-2)]">Internal medicine</p>
          </div>
          <div className={styles.status}>
            <div className={styles.statusLine}>
              <strong>{paused ? 'Paused preview' : 'Consultation preview'}</strong>
              <ScribeInputMeter level={0} active={false} />
            </div>
            <small>Example transcript · no live audio</small>
          </div>
          <div className={styles.actions}>
            <Button variant="secondary" onClick={() => setPaused(!paused)}>
              {paused ? 'Resume preview' : 'Pause preview'}
            </Button>
            <Button disabled>End &amp; review note</Button>
          </div>
        </div>
        <ScribeLiveWorkspace
          transcript={
            <TranscriptPanel
              utterances={utterances}
              partialText=""
              highlightIds={new Set()}
              refs={refs}
              listening={false}
            />
          }
          note={
            <NotePanel
              note={{
                chiefComplaint: 'Tiredness for two weeks.',
                hpi: 'Reports irregular sleep and late working hours. Previous reports brought for review.',
                assessment: 'Clinician assessment pending.',
                plan: 'Complete history and examination; review previous reports with the patient.',
              }}
              specialty="Internal medicine"
              live={false}
              assessmentAdds={[]}
            />
          }
          prescription={
            <RxPadPanel
              rxPad={{
                meds: [],
                investigations: [],
                adviceLines: ['Bring previous reports to the next visit.'],
              }}
              confirmedDrugs={new Set()}
              onConfirm={() => {}}
              onQuote={() => {}}
              live={false}
            />
          }
          copilot={
            <DifferentialZone
              reasoning={null}
              findings={[]}
              live={false}
              onEvidence={() => {}}
              onAddToAssessment={() => {}}
              addedToAssessment={[]}
            />
          }
        />
      </div>
    </main>
  );
}
