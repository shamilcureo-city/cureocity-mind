'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { MedicalEncounterNoteV1 } from '@cureocity/contracts';
import {
  SCRIBE_CODING_MAX_ENTRIES,
  ScribeCodingResponseSchema,
  ScribeCodingWorksheetSchema,
  type ScribeCodingEntry,
  type ScribeCodingResponse,
  type ScribeCodingWorksheet,
} from '@/lib/scribe-coding';
import { useUnsavedWorkGuard } from '@/lib/use-unsaved-work-guard';
import styles from './ScribeCodingPanel.module.css';

type LocalWorksheet = {
  worksheet: ScribeCodingWorksheet;
  saved: string;
  sourceKey: string;
};

function stateKey(state: ScribeCodingResponse): string {
  return JSON.stringify([
    state.draft.id,
    state.draft.hash,
    state.record?.id,
    state.record?.revision,
    state.record?.body.worksheet,
  ]);
}

function fromState(state: ScribeCodingResponse): LocalWorksheet {
  const worksheet: ScribeCodingWorksheet = state.record?.body.worksheet ?? {
    version: 'V1',
    status: 'draft',
    entries: [],
  };
  return { worksheet, saved: JSON.stringify(worksheet), sourceKey: stateKey(state) };
}

const decisionLabel = { pending: 'Pending', include: 'Include', exclude: 'Exclude' } as const;

export function ScribeCodingPanel({
  note,
  state,
  currentNoteHash,
  loading,
  error,
  saving,
  signed,
  disabled = false,
  onSave,
  onReload,
  onReviewSource,
  onWorkChange,
}: {
  note: MedicalEncounterNoteV1;
  state: ScribeCodingResponse | null;
  currentNoteHash: string | null;
  loading: boolean;
  error: string | null;
  saving: boolean;
  signed: boolean;
  disabled?: boolean;
  onSave: (worksheet: ScribeCodingWorksheet) => Promise<ScribeCodingResponse | null>;
  onReload: () => void;
  onReviewSource: () => void;
  onWorkChange?: (blocked: boolean) => void;
}) {
  const id = useId();
  const [local, setLocal] = useState<LocalWorksheet | null>(() =>
    state ? fromState(state) : null,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmReload, setConfirmReload] = useState(false);
  const [attested, setAttested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const workCallbackRef = useRef(onWorkChange);
  workCallbackRef.current = onWorkChange;
  const incomingKey = state ? stateKey(state) : null;
  const dirty = Boolean(local && JSON.stringify(local.worksheet) !== local.saved);
  const pendingSave = busy || saving;
  const sourceChanged = Boolean(local && incomingKey && local.sourceKey !== incomingKey);
  const readOnly = signed || state?.signed || disabled || loading || pendingSave || !state;
  const cannotSave = Boolean(readOnly || !local || sourceChanged || !currentNoteHash);
  const entries = local?.worksheet.entries ?? [];
  const selected = entries.find((entry) => entry.id === selectedId) ?? entries[0];
  const reviewed = Boolean(
    state?.record?.body.worksheet.status === 'reviewed' &&
    !dirty &&
    !sourceChanged &&
    state.sourceCurrent &&
    currentNoteHash &&
    state.record.body.reviewedNoteHash === currentNoteHash,
  );
  const reviewOutdated = Boolean(state?.record?.body.worksheet.status === 'reviewed' && !reviewed);
  const pendingCount = entries.filter((entry) => entry.decision === 'pending').length;
  const suggestions = (state?.suggestions ?? []).filter(
    (suggestion) =>
      !entries.some(
        (entry) =>
          entry.id === suggestion.id ||
          entry.sourceSuggestionId === (suggestion.sourceSuggestionId ?? suggestion.id),
      ),
  );

  useUnsavedWorkGuard(
    dirty,
    'This coding worksheet has unsaved changes. Leave without saving them?',
    pendingSave,
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      workCallbackRef.current?.(false);
    };
  }, []);

  useEffect(() => {
    workCallbackRef.current?.(dirty || pendingSave);
  }, [dirty, pendingSave, onWorkChange]);

  useEffect(() => {
    if (state && !dirty && !pendingSave && local?.sourceKey !== incomingKey) {
      setLocal(fromState(state));
      setSelectedId(null);
      setAttested(false);
      setReceipt(null);
    }
  }, [state, incomingKey, local?.sourceKey, dirty, pendingSave]);

  useEffect(() => {
    setAttested(false);
    setReceipt(null);
  }, [currentNoteHash]);

  useEffect(() => {
    if (focusRequest > 0) {
      editorRef.current?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
      editorRef.current?.focus({ preventScroll: true });
    }
  }, [focusRequest]);

  function replaceEntries(next: ScribeCodingEntry[]) {
    if (readOnly || !local) return;
    setLocal({ ...local, worksheet: { version: 'V1', status: 'draft', entries: next } });
    setAttested(false);
    setMessage(null);
    setReceipt(null);
  }

  function selectEntry(entryId: string) {
    setSelectedId(entryId);
    setFocusRequest((value) => value + 1);
  }

  function addEntry(suggestion?: ScribeCodingEntry) {
    if (readOnly || !local || entries.length >= SCRIBE_CODING_MAX_ENTRIES) return;
    const entry: ScribeCodingEntry = suggestion
      ? {
          ...suggestion,
          decision: 'pending',
          sourceSuggestionId: suggestion.sourceSuggestionId ?? suggestion.id,
        }
      : {
          id: crypto.randomUUID(),
          origin: 'manual',
          code: '',
          label: '',
          system: null,
          release: '',
          decision: 'pending',
          documentation: '',
        };
    replaceEntries([...entries, entry]);
    selectEntry(entry.id);
  }

  function editEntry(patch: Partial<ScribeCodingEntry>) {
    if (!selected) return;
    replaceEntries(
      entries.map((entry) => (entry.id === selected.id ? { ...entry, ...patch } : entry)),
    );
  }

  function reload() {
    if (pendingSave) return;
    if (dirty) setConfirmReload(true);
    else onReload();
  }

  function discardAndReload() {
    if (pendingSave) return;
    setLocal(state ? fromState(state) : null);
    setConfirmReload(false);
    setAttested(false);
    setMessage(null);
    setReceipt(null);
    onReload();
  }

  async function save(status: ScribeCodingWorksheet['status']) {
    if (cannotSave || busyRef.current || !local || !state) return;
    if (status === 'reviewed' && !attested) {
      setMessage(
        'Confirm that you checked the code definitions, release and supporting documentation.',
      );
      return;
    }
    const candidate = ScribeCodingWorksheetSchema.safeParse({ ...local.worksheet, status });
    if (!candidate.success) {
      setMessage(
        candidate.error.issues
          .map((issue) => {
            const index =
              issue.path[0] === 'entries' && typeof issue.path[1] === 'number'
                ? issue.path[1]
                : null;
            return `${index === null ? '' : `Entry ${index + 1}: `}${issue.message}`;
          })
          .join(' '),
      );
      const firstIndex = candidate.error.issues[0]?.path[1];
      if (typeof firstIndex === 'number' && entries[firstIndex])
        selectEntry(entries[firstIndex].id);
      return;
    }
    const expectedHash = currentNoteHash;
    const expectedDraft = state.draft;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    setReceipt(null);
    try {
      const result = ScribeCodingResponseSchema.safeParse(await onSave(candidate.data));
      if (!mountedRef.current) return;
      if (
        !result.success ||
        !result.data.record ||
        result.data.record.body.draftId !== expectedDraft.id ||
        result.data.record.body.draftHash !== expectedDraft.hash ||
        JSON.stringify(result.data.record.body.worksheet) !== JSON.stringify(candidate.data) ||
        (status === 'reviewed' && result.data.record.body.reviewedNoteHash !== expectedHash)
      ) {
        setMessage(
          'The save could not be confirmed. Your worksheet edits are still here. Retry saving or reload after preserving your work.',
        );
        return;
      }
      setLocal(fromState(result.data));
      setAttested(false);
      setReceipt(
        status === 'reviewed'
          ? 'Reviewed worksheet saved. The clinical note is unchanged.'
          : 'Draft worksheet saved. It has not been marked reviewed.',
      );
    } catch {
      if (mountedRef.current)
        setMessage(
          'The save could not be confirmed. Your worksheet edits are still here. Retry saving.',
        );
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  }

  return (
    <section className={styles.panel} aria-labelledby={`${id}-title`}>
      <header className={styles.header}>
        <div>
          <h2 id={`${id}-title`}>Coding worksheet</h2>
          <p>
            A separate doctor-reviewed worksheet, not part of the signed clinical note. It does not
            submit a claim or confirm reimbursement.
          </p>
        </div>
        <button
          className={styles.button}
          type="button"
          disabled={loading || pendingSave}
          onClick={reload}
        >
          Reload worksheet
        </button>
      </header>
      <div className={styles.notices}>
        <p className={styles.status} role="status">
          {signed || state?.signed
            ? 'Signed encounter · worksheet is read-only'
            : reviewed
              ? 'Reviewed for this note version'
              : dirty
                ? 'Unsaved worksheet changes'
                : 'Draft worksheet · not reviewed'}
        </p>
        {reviewOutdated && (
          <p className={styles.warning}>
            The note or worksheet changed after review. Check the coding again; the earlier review
            does not cover these changes.
          </p>
        )}
        {!reviewOutdated && state?.record && state.sourceCurrent === false && (
          <p className={styles.warning}>
            This worksheet was saved against a different note version. Recheck every included code
            before marking it reviewed.
          </p>
        )}
        {sourceChanged && dirty && (
          <p className={styles.warning} role="alert">
            The saved worksheet or note draft changed. Your local edits are still here, but saving
            is paused to avoid overwriting another version. Preserve any needed text before
            discarding and reloading.
          </p>
        )}
        {disabled && !signed && (
          <p className={styles.detail}>
            Finish the current note edit or resolve the encounter warning before saving coding
            changes.
          </p>
        )}
        {loading && <p role="status">Loading the saved coding worksheet…</p>}
        {error && (
          <p role="alert" className={styles.warning}>
            {error}
          </p>
        )}
        {message && (
          <p role="alert" className={styles.warning}>
            {message}
          </p>
        )}
        {receipt && (
          <p role="status" className={styles.detail}>
            {receipt}
          </p>
        )}
        {confirmReload && (
          <div className={styles.discard} role="group" aria-label="Unsaved worksheet changes">
            <p>Discard your unsaved coding changes and reload the saved worksheet?</p>
            <div className={styles.actions}>
              <button
                className={styles.button}
                type="button"
                disabled={pendingSave}
                onClick={discardAndReload}
              >
                Discard changes and reload
              </button>
              <button
                className={styles.textButton}
                type="button"
                onClick={() => setConfirmReload(false)}
              >
                Keep editing
              </button>
            </div>
          </div>
        )}
      </div>
      {local && (
        <>
          <div className={styles.context}>
            <div>
              <h3>{signed || state?.signed ? 'Saved signed note' : 'Applied assessment'}</h3>
              {signed || state?.signed ? (
                <p className={styles.detail}>
                  Review status uses the saved signed note, not the editable draft. The signed note
                  is unchanged.
                </p>
              ) : (
                <p className={styles.assessment}>
                  {note.assessment || 'No assessment recorded in the applied note.'}
                </p>
              )}
            </div>
            <button className={styles.textButton} type="button" onClick={onReviewSource}>
              Review note and source
            </button>
          </div>
          <div className={styles.worksheet}>
            <div className={styles.listPane}>
              <div className={styles.listHeader}>
                <h3>Worksheet entries</h3>
                <button
                  className={styles.button}
                  type="button"
                  disabled={Boolean(readOnly) || entries.length >= SCRIBE_CODING_MAX_ENTRIES}
                  onClick={() => addEntry()}
                >
                  Add code manually
                </button>
              </div>
              {entries.length >= SCRIBE_CODING_MAX_ENTRIES && (
                <p className={styles.detail}>
                  This worksheet holds up to {SCRIBE_CODING_MAX_ENTRIES} entries.
                </p>
              )}
              {entries.length ? (
                <ul className={styles.entries} aria-label="Coding worksheet entries">
                  {entries.map((entry) => (
                    <li key={entry.id}>
                      <button
                        type="button"
                        className={styles.entry}
                        aria-pressed={selected?.id === entry.id}
                        onClick={() => selectEntry(entry.id)}
                      >
                        <span className={styles.code}>{entry.code || 'Code not entered'}</span>
                        <span className={styles.entryLabel}>{entry.label || 'Untitled entry'}</span>
                        <span className={styles.entryMeta}>
                          {decisionLabel[entry.decision]} ·{' '}
                          {entry.origin === 'ai_suggestion' ? 'AI suggestion' : 'Manual entry'}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.empty}>
                  No codes added. Enter a code manually or choose an existing AI suggestion below.
                </p>
              )}
            </div>
            <div
              ref={editorRef}
              tabIndex={-1}
              className={styles.editor}
              aria-label="Selected code details"
            >
              {selected ? (
                <>
                  <h3>Selected code</h3>
                  {selected.origin === 'ai_suggestion' && (
                    <p className={styles.warning}>
                      Imported AI suggestion, not a confirmed diagnosis or validated code. Choose
                      the correct code system and release, then check the documentation yourself.
                    </p>
                  )}
                  <fieldset disabled={Boolean(readOnly)} className={styles.fields}>
                    <legend className={styles.srOnly}>Edit selected code</legend>
                    <label htmlFor={`${id}-system`}>Code system</label>
                    <select
                      id={`${id}-system`}
                      value={selected.system ?? ''}
                      onChange={(event) =>
                        editEntry({
                          system:
                            event.target.value === 'ICD10_WHO' || event.target.value === 'ICD10_CM'
                              ? event.target.value
                              : null,
                        })
                      }
                    >
                      <option value="">Choose code system</option>
                      <option value="ICD10_WHO">WHO ICD-10</option>
                      <option value="ICD10_CM">US ICD-10-CM</option>
                    </select>
                    <label htmlFor={`${id}-release`}>Release checked</label>
                    <input
                      id={`${id}-release`}
                      maxLength={120}
                      value={selected.release}
                      onChange={(event) => editEntry({ release: event.target.value })}
                      placeholder="Enter the exact edition or release checked"
                    />
                    <p className={styles.detail}>
                      WHO ICD-10 and US ICD-10-CM are different code sets. Confirm the applicable
                      release in the official reference.
                    </p>
                    <label htmlFor={`${id}-code`}>Code</label>
                    <input
                      id={`${id}-code`}
                      maxLength={24}
                      value={selected.code}
                      onChange={(event) => editEntry({ code: event.target.value })}
                      autoCapitalize="characters"
                      spellCheck={false}
                    />
                    <label htmlFor={`${id}-label`}>Code label</label>
                    <input
                      id={`${id}-label`}
                      maxLength={500}
                      value={selected.label}
                      onChange={(event) => editEntry({ label: event.target.value })}
                    />
                    <label htmlFor={`${id}-decision`}>Worksheet decision</label>
                    <select
                      id={`${id}-decision`}
                      value={selected.decision}
                      onChange={(event) =>
                        editEntry({ decision: event.target.value as ScribeCodingEntry['decision'] })
                      }
                    >
                      <option value="pending">Pending review</option>
                      <option value="include">Include in worksheet</option>
                      <option value="exclude">Exclude from worksheet</option>
                    </select>
                    <label htmlFor={`${id}-documentation`}>Documentation rationale</label>
                    <textarea
                      id={`${id}-documentation`}
                      maxLength={4000}
                      rows={4}
                      value={selected.documentation}
                      onChange={(event) => editEntry({ documentation: event.target.value })}
                      placeholder="Explain the note findings that support this code or why you excluded it."
                    />
                  </fieldset>
                  <button
                    className={styles.textButton}
                    type="button"
                    disabled={Boolean(readOnly)}
                    onClick={() =>
                      replaceEntries(entries.filter((entry) => entry.id !== selected.id))
                    }
                  >
                    Remove entry
                  </button>
                </>
              ) : (
                <p className={styles.empty}>
                  Select an entry to check its code, release and documentation.
                </p>
              )}
            </div>
          </div>
          {(state?.suggestions.length ?? 0) > 0 && (
            <details className={styles.suggestions}>
              <summary>Existing AI coding suggestions ({suggestions.length} not added)</summary>
              <p className={styles.detail}>
                From the existing differential, not a new coding analysis. Suggestions may be
                incorrect or refer to a different note version. Nothing is added automatically.
              </p>
              {suggestions.length ? (
                <ul>
                  {suggestions.map((suggestion) => (
                    <li key={suggestion.id}>
                      <div>
                        <p>
                          {suggestion.code || 'No code suggested'} —{' '}
                          {suggestion.label || 'Unlabelled suggestion'}
                        </p>
                        {suggestion.documentation && (
                          <p className={styles.detail}>{suggestion.documentation}</p>
                        )}
                      </div>
                      <button
                        className={styles.button}
                        type="button"
                        disabled={Boolean(readOnly) || entries.length >= SCRIBE_CODING_MAX_ENTRIES}
                        onClick={() => addEntry(suggestion)}
                      >
                        Add suggestion to worksheet
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.detail}>
                  All existing suggestions have been added for review.
                </p>
              )}
            </details>
          )}
          <footer className={styles.footer}>
            <div className={styles.references}>
              <span>Official references:</span>
              <a
                href="https://icd.who.int/browse10/2019/en"
                target="_blank"
                rel="noopener noreferrer"
                referrerPolicy="no-referrer"
              >
                WHO ICD-10 (2019)
              </a>
              <a
                href="https://www.cdc.gov/nchs/icd/icd-10-cm/"
                target="_blank"
                rel="noopener noreferrer"
                referrerPolicy="no-referrer"
              >
                CDC ICD-10-CM releases
              </a>
            </div>
            <p className={styles.detail}>
              This worksheet does not search a complete code catalog, validate code definitions or
              establish claim eligibility. Included entries need a code system, release, code, label
              and supporting documentation.
            </p>
            {pendingCount > 0 && (
              <p className={styles.detail}>
                {pendingCount} {pendingCount === 1 ? 'entry is' : 'entries are'} pending. Resolve
                each as include or exclude before marking reviewed.
              </p>
            )}
            <label className={styles.attestation}>
              <input
                type="checkbox"
                checked={attested}
                disabled={Boolean(readOnly)}
                onChange={(event) => setAttested(event.target.checked)}
              />
              <span>
                I checked the code definitions, release and supporting documentation for this
                worksheet.
              </span>
            </label>
            <div className={styles.actions}>
              <button
                className={styles.button}
                type="button"
                disabled={cannotSave}
                onClick={() => void save('draft')}
              >
                {pendingSave ? 'Saving worksheet…' : 'Save draft worksheet'}
              </button>
              <button
                className={styles.primaryButton}
                type="button"
                disabled={cannotSave || !attested || pendingCount > 0}
                onClick={() => void save('reviewed')}
              >
                Mark reviewed and save
              </button>
            </div>
          </footer>
        </>
      )}
    </section>
  );
}
