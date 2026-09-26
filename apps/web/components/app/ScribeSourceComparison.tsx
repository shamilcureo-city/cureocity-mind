'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type {
  EvidenceRef,
  MedicalEncounterNoteV1,
  MedicalEvidenceField,
} from '@cureocity/contracts';
import {
  SOURCE_REVIEW_FIELDS,
  resolveSourceEvidence,
  sourceFieldText,
  sourceNoteIdentity,
  type ScribeSourceSnapshot,
} from '@/lib/scribe-source-review';
import styles from './ScribeSourceComparison.module.css';

type Selection = {
  field: MedicalEvidenceField;
  evidenceIndex: number;
  matchIndex: number;
  version: string;
  noteIdentity: string;
};

function timestamp(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function ScribeSourceComparison({
  note,
  baseline,
  source,
  loading,
  error,
  onRetry,
  onClose,
  activeField,
  onSelectField,
  children,
  open = true,
  editing = false,
  focusRequest = 0,
}: {
  note: MedicalEncounterNoteV1;
  baseline: MedicalEncounterNoteV1;
  source: ScribeSourceSnapshot | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onClose: () => void;
  activeField: MedicalEvidenceField;
  onSelectField: (field: MedicalEvidenceField) => void;
  children: ReactNode;
  open?: boolean;
  editing?: boolean;
  focusRequest?: number;
}) {
  const selectorId = useId();
  const transcriptId = useId();
  const highlightRef = useRef<HTMLElement | null>(null);
  const sourcePaneRef = useRef<HTMLElement | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const noteIdentity = sourceNoteIdentity(note);
  const staleDraft = Boolean(
    source && sourceNoteIdentity(source.draftContent) !== sourceNoteIdentity(baseline),
  );
  const fieldText = sourceFieldText(note, activeField);
  const fieldEdited = fieldText !== sourceFieldText(baseline, activeField);
  const available =
    !loading &&
    !error &&
    source?.sourceState === 'available' &&
    typeof source.transcript === 'string' &&
    source.transcript.length > 0;
  const transcript = available ? source.transcript! : null;
  const mayLocate = available && !staleDraft;
  const evidence = baseline.linkedEvidence
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.field === activeField);
  const unassigned = baseline.linkedEvidence.filter((item) => !item.field);
  const selectedEvidence =
    selection &&
    mayLocate &&
    selection.field === activeField &&
    selection.version === source.version &&
    selection.noteIdentity === noteIdentity
      ? baseline.linkedEvidence[selection.evidenceIndex]
      : null;
  const selectedMatch =
    selectedEvidence && selection
      ? resolveSourceEvidence(selectedEvidence, transcript).matches[selection.matchIndex]
      : null;

  useEffect(() => {
    if (selectedMatch) {
      highlightRef.current?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
      highlightRef.current?.focus({ preventScroll: true });
    }
  }, [selection, selectedMatch?.start, selectedMatch?.end]);

  useEffect(() => {
    if (open && focusRequest > 0) {
      sourcePaneRef.current?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
      sourcePaneRef.current?.focus({ preventScroll: true });
    }
  }, [open, focusRequest]);

  function showQuote(evidenceIndex: number, matchIndex: number) {
    if (!mayLocate || !source) return;
    setSelection({
      field: activeField,
      evidenceIndex,
      matchIndex,
      version: source.version,
      noteIdentity,
    });
  }

  function reference(item: EvidenceRef, index: number) {
    const result = resolveSourceEvidence(item, transcript);
    const status = staleDraft
      ? 'Source comparison is out of date'
      : result.status === 'located'
        ? 'Quoted text found'
        : result.status === 'not_found'
          ? 'Quote not found in saved transcript'
          : result.status === 'no_quote'
            ? 'No linked quote'
            : 'Quote could not be checked';
    return (
      <li key={index} className={styles.reference}>
        <p className={styles.referenceStatus}>{status}</p>
        {item.claim && <p className={styles.claim}>Original draft statement: {item.claim}</p>}
        {item.quote?.trim() && <blockquote className={styles.quote}>{item.quote}</blockquote>}
        {typeof item.startMs === 'number' && Number.isFinite(item.startMs) && item.startMs >= 0 && (
          <p className={styles.detail}>
            Original reference time {timestamp(item.startMs)}. This is a model-provided reference,
            not a verified audio location.
          </p>
        )}
        {fieldEdited && (
          <p className={styles.detail}>
            This original reference does not verify your edited section.
          </p>
        )}
        {mayLocate && result.status === 'located' && (
          <>
            {result.matches.length > 1 && (
              <p className={styles.detail}>
                {result.truncated ? 'At least ' : ''}
                {result.matches.length} occurrences in the saved transcript. Check the surrounding
                words.
              </p>
            )}
            <div className={styles.matchActions}>
              {result.matches.map((match, matchIndex) => (
                <button
                  key={`${match.start}-${match.end}`}
                  type="button"
                  className={styles.textButton}
                  aria-controls={transcriptId}
                  aria-pressed={
                    selection?.evidenceIndex === index &&
                    selection?.matchIndex === matchIndex &&
                    selectedMatch !== null
                  }
                  onClick={() => showQuote(index, matchIndex)}
                >
                  {result.matches.length === 1
                    ? 'Show quoted text'
                    : `Show occurrence ${matchIndex + 1}`}
                </button>
              ))}
            </div>
          </>
        )}
        {result.truncated && (
          <p className={styles.warning}>
            {result.status === 'located'
              ? 'Only the first 50 locations are listed. The full saved transcript is shown below.'
              : 'This reference exceeds the automatic text-comparison limit. Read the full saved transcript; no match result is available.'}
          </p>
        )}
      </li>
    );
  }

  const sourceMessage =
    source?.sourceState === 'empty'
      ? 'No transcript was saved. These note statements cannot be compared with a saved transcript.'
      : source?.sourceState === 'quarantined'
        ? 'The saved transcript is hidden because it needs review. Do not treat its quotes as checked source material.'
        : source?.sourceMessage ||
          'The saved transcript could not be opened. Retry loading the source before relying on this comparison.';

  return (
    <section
      className={`${styles.frame} ${open ? '' : styles.closed}`}
      aria-label={open ? 'Note and source comparison' : 'Clinical note'}
    >
      {open && (
        <header className={styles.header}>
          <div>
            <h2>Compare note with source</h2>
            <p>
              Saved transcript only. Finding quoted words does not establish clinical correctness or
              transcription accuracy.
            </p>
          </div>
          <button type="button" className={styles.button} onClick={onClose}>
            Close comparison
          </button>
        </header>
      )}
      <div className={styles.columns}>
        <div className={styles.notePane}>{children}</div>
        {open && (
          <aside
            ref={sourcePaneRef}
            tabIndex={-1}
            className={styles.sourcePane}
            aria-label="Saved source comparison"
          >
            <div className={styles.sourceHeading}>
              <h3>Saved source</h3>
              <button
                type="button"
                className={styles.textButton}
                onClick={onRetry}
                disabled={loading}
              >
                {loading ? 'Loading…' : 'Reload source'}
              </button>
            </div>
            <label className={styles.selectorLabel} htmlFor={selectorId}>
              Compare a note section
            </label>
            <select
              id={selectorId}
              className={styles.selector}
              value={activeField}
              onChange={(event) => onSelectField(event.target.value as MedicalEvidenceField)}
            >
              {SOURCE_REVIEW_FIELDS.map(({ field, label }) => (
                <option key={field} value={field}>
                  {label}
                </option>
              ))}
            </select>
            <div className={styles.currentSection}>
              <h4>{editing ? 'Applied note text' : 'Current note section'}</h4>
              <p className={styles.currentText}>
                {fieldText || 'This section has no recorded text.'}
              </p>
              {editing && (
                <p className={styles.detail}>
                  Text being typed in the editor is not reflected here until you apply your
                  corrections.
                </p>
              )}
            </div>
            {fieldEdited && (
              <p className={styles.warning}>
                You changed this section. The original AI references have not been updated to
                support your corrections. Compare the new wording yourself.
              </p>
            )}
            {loading ? (
              <div role="status" className={styles.empty}>
                <p>Loading the saved source… Your note and edits remain on this page.</p>
                <div className={styles.skeleton} aria-hidden="true" />
              </div>
            ) : error ? (
              <div role="alert" className={styles.empty}>
                <h4>Source comparison unavailable</h4>
                <p>{error}</p>
                <button type="button" className={styles.button} onClick={onRetry}>
                  Retry loading source
                </button>
              </div>
            ) : !available ? (
              <div role="status" className={styles.empty}>
                <h4>
                  {source?.sourceState === 'empty'
                    ? 'No saved transcript'
                    : source?.sourceState === 'quarantined'
                      ? 'Source hidden for review'
                      : 'Source unavailable'}
                </h4>
                <p>{sourceMessage}</p>
                <button type="button" className={styles.button} onClick={onRetry}>
                  Retry loading source
                </button>
              </div>
            ) : (
              <>
                {source.sourceMessage && (
                  <p role="status" className={styles.warning}>
                    {source.sourceMessage}
                  </p>
                )}
                {staleDraft && (
                  <p role="alert" className={styles.warning}>
                    The saved draft changed after this note was opened. Quote matching is paused.
                    Your edits remain untouched; reload the encounter after preserving your
                    corrections to review the current draft.
                  </p>
                )}
                {!staleDraft && (
                  <section className={styles.references} aria-label="Original linked quotes">
                    <h4>
                      {fieldEdited ? 'Original draft references' : 'Linked transcript quotes'}
                    </h4>
                    {evidence.length ? (
                      <ul>{evidence.map(({ item, index }) => reference(item, index))}</ul>
                    ) : (
                      <p className={styles.detail}>
                        No linked quote for this section. Review the full transcript; absence of a
                        link does not prove the note is wrong.
                      </p>
                    )}
                    {unassigned.length > 0 && (
                      <details className={styles.unassigned}>
                        <summary>
                          {unassigned.length} original{' '}
                          {unassigned.length === 1 ? 'reference is' : 'references are'} not assigned
                          to a section
                        </summary>
                        <p className={styles.detail}>
                          These references are not evidence for the selected section.
                        </p>
                        {unassigned.map((item, index) => (
                          <blockquote key={index} className={styles.quote}>
                            {item.quote || 'No linked quote'}
                          </blockquote>
                        ))}
                      </details>
                    )}
                  </section>
                )}
                <section
                  className={styles.transcriptSection}
                  aria-labelledby={`${transcriptId}-heading`}
                >
                  <h4 id={`${transcriptId}-heading`}>Full saved transcript</h4>
                  <p className={styles.detail}>
                    Review the context and speaker labels. No audio playback or independent source
                    validation is provided here.
                  </p>
                  <div
                    id={transcriptId}
                    role="region"
                    tabIndex={0}
                    aria-label="Full saved transcript"
                    className={styles.transcript}
                  >
                    {selectedMatch && transcript ? (
                      <>
                        {transcript.slice(0, selectedMatch.start)}
                        <mark
                          ref={highlightRef}
                          tabIndex={-1}
                          aria-label="Located quote in saved transcript"
                          className={styles.highlight}
                        >
                          {transcript.slice(selectedMatch.start, selectedMatch.end)}
                        </mark>
                        {transcript.slice(selectedMatch.end)}
                      </>
                    ) : (
                      transcript
                    )}
                  </div>
                </section>
              </>
            )}
          </aside>
        )}
      </div>
    </section>
  );
}
