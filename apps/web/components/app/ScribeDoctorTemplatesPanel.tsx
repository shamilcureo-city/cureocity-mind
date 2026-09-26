'use client';

import { useEffect, useId, useRef, useState } from 'react';
import {
  SCRIBE_BUILTIN_DOCTOR_TEMPLATES,
  SCRIBE_DOCTOR_TEMPLATE_MAX_RECORDS,
  SCRIBE_DOCUMENT_TEMPLATE_PROMPTS,
  SCRIBE_DOCUMENT_TEMPLATE_PROMPT_LABELS,
  ScribeDoctorTemplateSchema,
  ScribeDoctorTemplateRecordSchema,
  renderScribeDocumentTemplate,
  type ScribeDoctorTemplate,
  type ScribeDoctorTemplateRecord,
} from '@/lib/scribe-doctor-templates';
import type { useScribeDoctorTemplates } from '@/lib/use-scribe-doctor-templates';
import { useUnsavedWorkGuard } from '@/lib/use-unsaved-work-guard';
import { SCRIBE_NOTE_LABELS, type ScribeNoteStyle } from '@/lib/scribe-personalization-contracts';
import styles from './ScribeDoctorTemplatesPanel.module.css';

export function ScribeDoctorTemplatesPanel({
  settings,
  onWorkChange,
}: {
  settings: ReturnType<typeof useScribeDoctorTemplates>;
  onWorkChange?: (blocked: boolean) => void;
}) {
  const id = useId();
  const [starter, setStarter] = useState(0);
  const [draft, setDraft] = useState<ScribeDoctorTemplate | null>(null);
  const [existing, setExisting] = useState<ScribeDoctorTemplateRecord | undefined>();
  const [saved, setSaved] = useState<string | null>(null);
  const [profileKey, setProfileKey] = useState<'firstVisit' | 'followUp'>('firstVisit');
  const [acknowledged, setAcknowledged] = useState(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const lock = useRef(false);
  const mounted = useRef(true);
  const callback = useRef(onWorkChange);
  callback.current = onWorkChange;
  const dirty = Boolean(draft && JSON.stringify(draft) !== saved);
  const busy = working || settings.busy;
  const blocked = busy || settings.loading || !settings.loaded;
  const currentRecord = existing
    ? settings.records.find((record) => record.id === existing.id)
    : undefined;
  const conflict = Boolean(
    existing && settings.loaded && (!currentRecord || currentRecord.revision !== existing.revision),
  );
  useUnsavedWorkGuard(dirty, 'This template has unsaved changes. Leave without saving them?', busy);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      callback.current?.(false);
    };
  }, []);
  useEffect(() => {
    callback.current?.(dirty || busy);
  }, [dirty, busy, onWorkChange]);
  useEffect(() => {
    if (!settings.loaded) {
      setDraft(null);
      setExisting(undefined);
      setSaved(null);
      setAcknowledged(false);
      setReceipt(null);
    }
  }, [settings.loaded]);
  useEffect(() => {
    if (!existing || dirty || busy || settings.loading || !conflict) return;
    setExisting(currentRecord);
    setDraft(currentRecord?.body.template ?? null);
    setSaved(currentRecord ? JSON.stringify(currentRecord.body.template) : null);
    setAcknowledged(false);
    setReceipt(null);
  }, [existing, currentRecord, dirty, busy, settings.loading, conflict]);
  function allowDiscard() {
    return (
      !blocked &&
      (!dirty || window.confirm('Discard the unsaved template changes before continuing?'))
    );
  }
  function open(record: ScribeDoctorTemplateRecord) {
    if (record.id === existing?.id || !allowDiscard()) return;
    setExisting(record);
    setDraft(structuredClone(record.body.template));
    setSaved(JSON.stringify(record.body.template));
    setAcknowledged(false);
    setMessage(null);
    setReceipt(null);
  }
  function start(template: ScribeDoctorTemplate) {
    if (settings.records.length >= SCRIBE_DOCTOR_TEMPLATE_MAX_RECORDS || !allowDiscard()) return;
    setExisting(undefined);
    setDraft(structuredClone(template));
    setSaved(null);
    setAcknowledged(false);
    setMessage(null);
    setReceipt(null);
  }
  function change(next: ScribeDoctorTemplate) {
    if (blocked || lock.current) return;
    setDraft(next);
    setAcknowledged(false);
    setMessage(null);
    setReceipt(null);
  }
  function movePrompt(index: number, direction: -1 | 1) {
    if (draft?.kind !== 'document_skeleton') return;
    const destination = index + direction;
    if (destination < 0 || destination >= draft.prompts.length) return;
    const prompts = [...draft.prompts];
    [prompts[index], prompts[destination]] = [prompts[destination], prompts[index]];
    change({ ...draft, prompts });
  }
  async function save() {
    if (!draft || blocked || conflict || lock.current || !acknowledged) return;
    const parsed = ScribeDoctorTemplateSchema.safeParse(draft);
    if (!parsed.success) {
      setMessage(
        'Enter a template name and complete every heading or choose valid document prompts.',
      );
      return;
    }
    lock.current = true;
    setWorking(true);
    setMessage(null);
    setReceipt(null);
    try {
      const result = ScribeDoctorTemplateRecordSchema.safeParse(
        await settings.save(parsed.data, existing),
      );
      if (!mounted.current) return;
      if (
        !result.success ||
        (existing &&
          (result.data.id !== existing.id ||
            result.data.revision <= existing.revision ||
            JSON.stringify(result.data.body.template) !== JSON.stringify(parsed.data)))
      ) {
        setMessage(
          'The template save could not be confirmed. Your changes are still here. Retry or preserve them before reloading.',
        );
        return;
      }
      setExisting(result.data);
      setDraft(result.data.body.template);
      setSaved(JSON.stringify(result.data.body.template));
      setAcknowledged(false);
      setReceipt(
        JSON.stringify(result.data.body.template) !== JSON.stringify(parsed.data)
          ? 'Template creation confirmed. A newer saved version was returned; review it before use. No note or document was changed.'
          : 'Template saved to your personal library. It has not been applied to a note or document.',
      );
    } catch {
      if (mounted.current)
        setMessage('The template save failed. Your changes are still here. Retry.');
    } finally {
      lock.current = false;
      if (mounted.current) setWorking(false);
    }
  }
  async function remove() {
    if (
      !existing ||
      blocked ||
      conflict ||
      lock.current ||
      !allowDiscard() ||
      !window.confirm(
        'Delete this saved personal template? Existing clinical notes and document drafts will not change.',
      )
    )
      return;
    lock.current = true;
    setWorking(true);
    setMessage(null);
    setReceipt(null);
    try {
      const removed = await settings.remove(existing);
      if (!mounted.current) return;
      if (!removed) {
        setMessage('Template deletion could not be confirmed. Reload the library before retrying.');
        return;
      }
      setExisting(undefined);
      setDraft(null);
      setSaved(null);
      setAcknowledged(false);
      setReceipt('Personal template deleted. Existing notes and document drafts are unchanged.');
    } catch {
      if (mounted.current)
        setMessage('Template deletion failed. Reload the library before retrying.');
    } finally {
      lock.current = false;
      if (mounted.current) setWorking(false);
    }
  }
  function reload() {
    if (
      busy ||
      settings.loading ||
      (dirty && !window.confirm('Discard the unsaved template changes before reloading?'))
    )
      return;
    if (existing && currentRecord) {
      setExisting(currentRecord);
      setDraft(structuredClone(currentRecord.body.template));
      setSaved(JSON.stringify(currentRecord.body.template));
    } else {
      setDraft(null);
      setExisting(undefined);
      setSaved(null);
    }
    setAcknowledged(false);
    setMessage(null);
    setReceipt(null);
    void settings.reload();
  }
  return (
    <section className={styles.panel} aria-labelledby={`${id}-title`}>
      <header className={styles.header}>
        <div>
          <h2 id={`${id}-title`}>My doctor templates</h2>
          <p>
            Use templates for note presentation or blank document prompts only. Never include
            patient details; templates are not applied automatically.
          </p>
        </div>
        <button
          type="button"
          className={styles.button}
          disabled={busy || settings.loading}
          onClick={reload}
        >
          Reload templates
        </button>
      </header>
      <div className={styles.notices}>
        {settings.loading && <p role="status">Loading your personal templates…</p>}
        {settings.error && (
          <p role="alert" className={styles.warning}>
            {settings.error}
          </p>
        )}
        {message && (
          <p role="alert" className={styles.warning}>
            {message}
          </p>
        )}
        {receipt && <p role="status">{receipt}</p>}
        {conflict && dirty && (
          <p role="alert" className={styles.warning}>
            This saved template changed elsewhere. Your local edits are still here. Preserve any
            needed wording before reloading; saving is paused.
          </p>
        )}
        {dirty && (
          <p role="status" className={styles.detail}>
            Unsaved template changes.
          </p>
        )}
      </div>
      <div className={styles.layout}>
        <aside className={styles.library} aria-label="Personal template library">
          <h3>Start with a template</h3>
          <label htmlFor={`${id}-starter`}>
            Built-in starting point
            <select
              id={`${id}-starter`}
              disabled={blocked}
              value={starter}
              onChange={(event) => setStarter(Number(event.target.value))}
            >
              {SCRIBE_BUILTIN_DOCTOR_TEMPLATES.map((template, index) => (
                <option key={index} value={index}>
                  {template.name}
                </option>
              ))}
            </select>
          </label>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.button}
              disabled={blocked || settings.records.length >= SCRIBE_DOCTOR_TEMPLATE_MAX_RECORDS}
              onClick={() => start(SCRIBE_BUILTIN_DOCTOR_TEMPLATES[starter])}
            >
              Create from starting point
            </button>
          </div>
          {settings.records.length >= SCRIBE_DOCTOR_TEMPLATE_MAX_RECORDS && (
            <p className={styles.detail}>
              Your library holds up to {SCRIBE_DOCTOR_TEMPLATE_MAX_RECORDS} personal templates. Edit
              or remove one before creating another.
            </p>
          )}
          <h3>Your saved templates</h3>
          {settings.records.length ? (
            <ul>
              {settings.records.map((record) => (
                <li key={record.id}>
                  <button
                    type="button"
                    className={styles.record}
                    disabled={busy}
                    aria-pressed={existing?.id === record.id}
                    onClick={() => open(record)}
                  >
                    {record.body.template.name}
                    <small>
                      {record.body.template.kind === 'note_presentation'
                        ? 'Note presentation'
                        : 'Document prompts'}
                    </small>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.detail}>
              No personal templates saved yet. Choose a starting point to make one.
            </p>
          )}
        </aside>
        <div className={styles.editor}>
          {settings.loaded && draft ? (
            <>
              <h3>{existing ? 'Edit personal template' : 'New personal template'}</h3>
              <label htmlFor={`${id}-name`}>
                Template name
                <input
                  id={`${id}-name`}
                  maxLength={80}
                  disabled={blocked}
                  value={draft.name}
                  onChange={(event) => change({ ...draft, name: event.target.value })}
                />
              </label>
              {draft.kind === 'note_presentation' ? (
                <ScribeNoteStyleProfileEditor
                  style={draft.style}
                  profileKey={profileKey}
                  onProfileKeyChange={setProfileKey}
                  onChange={(style) => change({ ...draft, style })}
                  disabled={blocked}
                  idPrefix={`${id}-note`}
                />
              ) : (
                <>
                  <p className={styles.detail}>
                    Document type: {draft.documentType.replaceAll('_', ' ')}. Choose fixed prompts;
                    enter patient details only in the encounter document, never in this template.
                  </p>
                  <fieldset className={styles.prompts} disabled={blocked}>
                    <legend>Prompts to include</legend>
                    {SCRIBE_DOCUMENT_TEMPLATE_PROMPTS[draft.documentType].map((prompt) => (
                      <label key={prompt}>
                        <input
                          type="checkbox"
                          checked={draft.prompts.includes(prompt)}
                          onChange={(event) =>
                            change({
                              ...draft,
                              prompts: event.target.checked
                                ? [...draft.prompts, prompt]
                                : draft.prompts.filter((value) => value !== prompt),
                            })
                          }
                        />
                        <span>{SCRIBE_DOCUMENT_TEMPLATE_PROMPT_LABELS[prompt]}</span>
                      </label>
                    ))}
                  </fieldset>
                  <ol className={styles.promptOrder}>
                    {draft.prompts.map((prompt, index) => (
                      <li key={prompt}>
                        <span>{SCRIBE_DOCUMENT_TEMPLATE_PROMPT_LABELS[prompt]}</span>
                        <div>
                          <button
                            type="button"
                            className={styles.button}
                            disabled={blocked || index === 0}
                            aria-label={`Move ${SCRIBE_DOCUMENT_TEMPLATE_PROMPT_LABELS[prompt]} up`}
                            onClick={() => movePrompt(index, -1)}
                          >
                            Up
                          </button>
                          <button
                            type="button"
                            className={styles.button}
                            disabled={blocked || index === draft.prompts.length - 1}
                            aria-label={`Move ${SCRIBE_DOCUMENT_TEMPLATE_PROMPT_LABELS[prompt]} down`}
                            onClick={() => movePrompt(index, 1)}
                          >
                            Down
                          </button>
                        </div>
                      </li>
                    ))}
                  </ol>
                  <section className={styles.preview} aria-label="Document prompt preview">
                    <h4>Draft prompt preview</h4>
                    <p className={styles.detail}>
                      Preview only. Each prompt needs the doctor’s input when used in a document.
                    </p>
                    <pre>
                      {draft.prompts.length
                        ? renderScribeDocumentTemplate({
                            ...draft,
                            name: draft.name.trim() || 'Template preview',
                          })
                        : 'Choose at least one prompt.'}
                    </pre>
                  </section>
                </>
              )}
              <label className={styles.acknowledgement}>
                <input
                  type="checkbox"
                  checked={acknowledged}
                  disabled={blocked}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                />
                <span>
                  I confirm this template name and headings contain no patient details. This is
                  reusable presentation or prompts, not patient documentation.
                </span>
              </label>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.primaryButton}
                  disabled={blocked || conflict || !acknowledged}
                  onClick={() => void save()}
                >
                  {busy ? 'Saving template…' : 'Save personal template'}
                </button>
                {existing && (
                  <>
                    <button
                      type="button"
                      className={styles.button}
                      disabled={
                        blocked || settings.records.length >= SCRIBE_DOCTOR_TEMPLATE_MAX_RECORDS
                      }
                      onClick={() =>
                        start({
                          ...existing.body.template,
                          name: `${existing.body.template.name.slice(0, 75)} copy`,
                        })
                      }
                    >
                      Duplicate saved template
                    </button>
                    <button
                      type="button"
                      className={styles.textButton}
                      disabled={blocked || conflict}
                      onClick={() => void remove()}
                    >
                      Delete saved template
                    </button>
                  </>
                )}
              </div>
            </>
          ) : (
            <p className={styles.detail}>
              Choose a saved template to edit, or start a new one. Saving here does not change any
              clinical note or document.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

export function ScribeNoteStyleProfileEditor({
  style,
  profileKey,
  onProfileKeyChange,
  onChange,
  disabled = false,
  idPrefix,
}: {
  style: ScribeNoteStyle;
  profileKey: 'firstVisit' | 'followUp';
  onProfileKeyChange: (key: 'firstVisit' | 'followUp') => void;
  onChange: (next: ScribeNoteStyle) => void;
  disabled?: boolean;
  idPrefix: string;
}) {
  const profile = style[profileKey];
  function move(index: number, direction: -1 | 1) {
    const destination = index + direction;
    if (disabled || destination < 0 || destination >= profile.order.length) return;
    const order = [...profile.order];
    [order[index], order[destination]] = [order[destination], order[index]];
    onChange({ ...style, [profileKey]: { ...profile, order } });
  }
  return (
    <fieldset className={styles.profile} disabled={disabled}>
      <legend className={styles.srOnly}>Note presentation preview</legend>
      <div className={styles.profileControls}>
        <label htmlFor={`${idPrefix}-profile`}>
          Visit profile
          <select
            id={`${idPrefix}-profile`}
            value={profileKey}
            onChange={(event) =>
              onProfileKeyChange(event.target.value as 'firstVisit' | 'followUp')
            }
          >
            <option value="firstVisit">First visit</option>
            <option value="followUp">Follow-up</option>
          </select>
        </label>
        <label htmlFor={`${idPrefix}-density`}>
          Presentation
          <select
            id={`${idPrefix}-density`}
            value={profile.density}
            onChange={(event) =>
              onChange({
                ...style,
                [profileKey]: { ...profile, density: event.target.value as 'concise' | 'detailed' },
              })
            }
          >
            <option value="concise">Concise spacing</option>
            <option value="detailed">Detailed spacing</option>
          </select>
        </label>
      </div>
      <p className={styles.detail}>
        All seven sections remain present. Labels, order and spacing change presentation only; they
        do not add or remove clinical facts or source evidence.
      </p>
      <ol className={styles.noteFields}>
        {profile.order.map((field, index) => (
          <li key={field}>
            <label htmlFor={`${idPrefix}-${field}`}>
              {SCRIBE_NOTE_LABELS[field]} heading
              <input
                id={`${idPrefix}-${field}`}
                value={profile.labels[field]}
                maxLength={64}
                onChange={(event) =>
                  onChange({
                    ...style,
                    [profileKey]: {
                      ...profile,
                      labels: { ...profile.labels, [field]: event.target.value },
                    },
                  })
                }
              />
            </label>
            <button
              type="button"
              className={styles.button}
              aria-label={`Move ${SCRIBE_NOTE_LABELS[field]} up`}
              disabled={disabled || index === 0}
              onClick={() => move(index, -1)}
            >
              Up
            </button>
            <button
              type="button"
              className={styles.button}
              aria-label={`Move ${SCRIBE_NOTE_LABELS[field]} down`}
              disabled={disabled || index === profile.order.length - 1}
              onClick={() => move(index, 1)}
            >
              Down
            </button>
          </li>
        ))}
      </ol>
      <section
        className={`${styles.preview} ${profile.density === 'concise' ? styles.concise : ''}`}
        aria-label="Note heading preview"
      >
        <h4>Presentation preview</h4>
        {profile.order.map((field) => (
          <div key={field}>
            <h5>{profile.labels[field] || SCRIBE_NOTE_LABELS[field]}</h5>
            <p>
              Existing {SCRIBE_NOTE_LABELS[field].toLowerCase()} content and source evidence remain
              unchanged.
            </p>
          </div>
        ))}
      </section>
    </fieldset>
  );
}
