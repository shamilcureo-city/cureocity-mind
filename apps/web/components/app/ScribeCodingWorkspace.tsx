'use client';

import { useState } from 'react';
import type { MedicalEncounterNoteV1 } from '@cureocity/contracts';
import { useScribeCoding } from '@/lib/use-scribe-coding';
import { ScribeCodingPanel } from './ScribeCodingPanel';

/** Optional worksheet, loaded only when opened; never changes the clinical note. */
export function ScribeCodingWorkspace({
  sessionId,
  note,
  baseline,
  ready,
  signed,
  disabled = false,
  onReviewSource,
  onWorkChange,
  defaultOpen = false,
}: {
  sessionId: string;
  note: MedicalEncounterNoteV1;
  baseline: MedicalEncounterNoteV1;
  ready: boolean;
  signed: boolean;
  disabled?: boolean;
  onReviewSource: () => void;
  onWorkChange?: (blocked: boolean) => void;
  defaultOpen?: boolean;
}) {
  const [opened, setOpened] = useState(defaultOpen);
  const coding = useScribeCoding({ sessionId, note, baseline, enabled: opened && ready, signed });
  return (
    <details
      open={defaultOpen || undefined}
      onToggle={(event) => {
        if (event.currentTarget.open) setOpened(true);
      }}
      className="rounded-2xl border border-[var(--color-line)] bg-white p-4 sm:p-6"
    >
      <summary className="min-h-11 cursor-pointer py-2 font-serif text-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4">
        Diagnosis coding worksheet
      </summary>
      <p className="mb-4 mt-1 text-sm text-[var(--color-ink-2)]">
        Optional doctor review. Saved separately; not part of the clinical signature or an insurance
        claim.
      </p>
      {!ready && <p role="status">Save the consultation before opening its coding worksheet.</p>}
      {coding.baselineChanged && (
        <p role="alert" className="mb-4 text-sm text-[var(--color-warn)]">
          The saved note draft has changed. Keep your corrections and reload the encounter to review
          the newer note before saving coding. Reloading this worksheet alone will not replace the
          note you are editing.
        </p>
      )}
      {disabled && (
        <p role="status" className="mb-4 text-sm text-[var(--color-ink-2)]">
          Finish applying note corrections or the current signing action before editing coding.
        </p>
      )}
      {opened && ready && (
        <ScribeCodingPanel
          note={note}
          state={coding.state}
          currentNoteHash={
            coding.state?.signed ? coding.state.signedNoteHash : coding.currentNoteHash
          }
          loading={coding.loading}
          saving={coding.saving}
          error={coding.error}
          signed={signed || Boolean(coding.state?.signed)}
          disabled={disabled || coding.baselineChanged}
          onSave={coding.save}
          onReload={() => void coding.reload()}
          onReviewSource={onReviewSource}
          onWorkChange={onWorkChange}
        />
      )}
    </details>
  );
}
