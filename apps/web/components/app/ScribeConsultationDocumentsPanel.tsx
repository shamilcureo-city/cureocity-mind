'use client';

import { useEffect, useId, useRef, useState } from 'react';
import {
  SCRIBE_CONSULTATION_DOCUMENT_MAX_ADDITIONS,
  SCRIBE_CONSULTATION_DOCUMENT_MAX_PACKETS,
  ScribeConsultationDocumentsResponseSchema,
  type ScribeConsultationDocument,
  type ScribeConsultationDocumentPacket,
  type ScribeConsultationDocumentsResponse,
  type ScribeConsultationDocumentType,
} from '@/lib/scribe-consultation-documents';
import { useUnsavedWorkGuard } from '@/lib/use-unsaved-work-guard';
import { hasUnresolvedScribeTemplateFields } from '@/lib/scribe-doctor-templates';
import { ScribeDocumentTemplatePicker } from './ScribeDocumentTemplatePicker';
import styles from './ScribeConsultationDocumentsPanel.module.css';

const documentTypes: readonly { type: ScribeConsultationDocumentType; label: string }[] = [
  { type: 'referral', label: 'Referral' },
  { type: 'patient_summary', label: 'Patient summary' },
  { type: 'medical_certificate', label: 'Medical certificate' },
];
const title = (type: ScribeConsultationDocumentType) =>
  documentTypes.find((item) => item.type === type)!.label;
type Editor = {
  packetId: string;
  documentId: ScribeConsultationDocument['id'];
  revision: number;
  additions: string;
  savedAdditions: string;
};
function editorFor(
  packet: ScribeConsultationDocumentPacket,
  document: ScribeConsultationDocument,
): Editor {
  return {
    packetId: packet.id,
    documentId: document.id,
    revision: packet.revision,
    additions: document.additions,
    savedAdditions: document.additions,
  };
}
function firstEditor(state: ScribeConsultationDocumentsResponse | null): Editor | null {
  const packet = state?.packets.find((item) => item.body.documents.length > 0);
  return packet ? editorFor(packet, packet.body.documents[0]) : null;
}

export function ScribeConsultationDocumentsPanel({
  state,
  loading,
  busy,
  error,
  onReload,
  onCreate,
  onSave,
  onDownload,
  onWorkChange,
}: {
  state: ScribeConsultationDocumentsResponse | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  onReload: () => void;
  onCreate: (
    types: ScribeConsultationDocumentType[],
  ) => Promise<ScribeConsultationDocumentsResponse | null>;
  onSave: (
    packetId: string,
    revision: number,
    documentId: ScribeConsultationDocument['id'],
    additions: string,
    reviewed: boolean,
  ) => Promise<ScribeConsultationDocumentsResponse | null>;
  onDownload: (
    packet: ScribeConsultationDocumentPacket,
    document: ScribeConsultationDocument,
  ) => Promise<boolean>;
  onWorkChange?: (blocked: boolean) => void;
}) {
  const id = useId();
  const [types, setTypes] = useState<ScribeConsultationDocumentType[]>(
    documentTypes.map((item) => item.type),
  );
  const [editor, setEditor] = useState<Editor | null>(() => firstEditor(state));
  const [acknowledged, setAcknowledged] = useState(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const lock = useRef(false);
  const mounted = useRef(true);
  const workCallback = useRef(onWorkChange);
  workCallback.current = onWorkChange;
  const pending = busy || working;
  const ready = state?.source.state === 'ready';
  const dirty = Boolean(editor && editor.additions !== editor.savedAdditions);
  const packet = state?.packets.find((item) => item.id === editor?.packetId);
  const document = packet?.body.documents.find((item) => item.id === editor?.documentId);
  const changed = Boolean(packet && editor && packet.revision !== editor.revision);
  const sourceMatches = Boolean(
    ready &&
    packet?.sourceCurrent &&
    packet.body.sourceHash === state?.source.hash &&
    packet.body.noteId === state?.source.noteId &&
    packet.body.signedAt === state?.source.signedAt,
  );
  const current = sourceMatches && !changed;
  const blocked = pending || loading;
  const canSave = Boolean(document && editor && current && !blocked);
  const unfinished = Boolean(editor && hasUnresolvedScribeTemplateFields(editor.additions));
  const canDownload = Boolean(canSave && document?.status === 'reviewed' && !dirty && !unfinished);
  const reviewed = document?.status === 'reviewed' && !dirty && current && !unfinished;

  useUnsavedWorkGuard(
    dirty,
    'This document has unsaved doctor additions. Leave without saving them?',
    pending,
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      workCallback.current?.(false);
    };
  }, []);
  useEffect(() => {
    workCallback.current?.(dirty || pending);
  }, [dirty, pending, onWorkChange]);
  useEffect(() => {
    if (dirty || pending || loading) return;
    if (!editor && state) setEditor(firstEditor(state));
    else if (packet && document && changed) {
      setEditor(editorFor(packet, document));
      setAcknowledged(false);
      setReceipt(null);
    }
  }, [state, editor, packet, document, changed, dirty, pending, loading]);
  useEffect(() => {
    setAcknowledged(false);
    if (state?.source.state !== 'ready' || packet?.sourceCurrent === false) setReceipt(null);
  }, [state?.source.hash, state?.source.state, packet?.sourceCurrent]);

  function allowDiscard(): boolean {
    return (
      !blocked &&
      (!dirty || window.confirm('Discard the unsaved doctor additions before continuing?'))
    );
  }
  function select(
    nextPacket: ScribeConsultationDocumentPacket,
    nextDocument: ScribeConsultationDocument,
  ) {
    if (nextPacket.id === editor?.packetId && nextDocument.id === editor?.documentId) return;
    if (!allowDiscard()) return;
    setEditor(editorFor(nextPacket, nextDocument));
    setAcknowledged(false);
    setMessage(null);
    setReceipt(null);
  }
  function reload() {
    if (!allowDiscard()) return;
    if (packet && document) setEditor(editorFor(packet, document));
    setAcknowledged(false);
    setReceipt(null);
    setMessage(null);
    onReload();
  }
  function edit(value: string) {
    if (!editor || !canSave || lock.current) return;
    setEditor({ ...editor, additions: value });
    setAcknowledged(false);
    setReceipt(null);
    setMessage(null);
  }
  async function create() {
    if (
      !ready ||
      !types.length ||
      lock.current ||
      (state?.packets.length ?? 0) >= SCRIBE_CONSULTATION_DOCUMENT_MAX_PACKETS ||
      !allowDiscard()
    )
      return;
    lock.current = true;
    setWorking(true);
    setMessage(null);
    setReceipt(null);
    try {
      const result = ScribeConsultationDocumentsResponseSchema.safeParse(await onCreate(types));
      if (!mounted.current) return;
      if (
        !result.success ||
        result.data.source.state !== 'ready' ||
        result.data.source.hash !== state?.source.hash
      ) {
        setMessage(
          'Draft preparation could not be confirmed. Existing work is unchanged. Retry when the signed source is available.',
        );
        return;
      }
      const matchesRequest = (item: ScribeConsultationDocumentPacket) =>
        item.sourceCurrent &&
        item.body.sourceHash === state?.source.hash &&
        item.body.noteId === state?.source.noteId &&
        item.body.documents.length === types.length &&
        item.body.documents.every((doc) => types.includes(doc.type));
      const candidate =
        result.data.packets.find(
          (item) =>
            matchesRequest(item) && !state?.packets.some((previous) => previous.id === item.id),
        ) ?? result.data.packets.find(matchesRequest);
      if (!candidate?.sourceCurrent || !candidate.body.documents[0]) {
        setMessage('The prepared draft packet could not be confirmed. Existing work is unchanged.');
        return;
      }
      setEditor(editorFor(candidate, candidate.body.documents[0]));
      setAcknowledged(false);
      setReceipt('Selected document drafts prepared. Nothing has been issued or sent.');
    } catch {
      if (mounted.current)
        setMessage('Draft preparation failed. Existing work is unchanged. Retry.');
    } finally {
      lock.current = false;
      if (mounted.current) setWorking(false);
    }
  }
  async function save(markReviewed: boolean) {
    if (
      !canSave ||
      !editor ||
      !packet ||
      !document ||
      lock.current ||
      (markReviewed && (!acknowledged || unfinished))
    )
      return;
    lock.current = true;
    setWorking(true);
    setMessage(null);
    setReceipt(null);
    const expected = { ...editor };
    try {
      const result = ScribeConsultationDocumentsResponseSchema.safeParse(
        await onSave(packet.id, editor.revision, document.id, editor.additions, markReviewed),
      );
      if (!mounted.current) return;
      const savedPacket = result.success
        ? result.data.packets.find((item) => item.id === expected.packetId)
        : null;
      const savedDocument = savedPacket?.body.documents.find(
        (item) => item.id === expected.documentId,
      );
      if (
        !savedPacket?.sourceCurrent ||
        !savedDocument ||
        savedPacket.revision <= expected.revision ||
        savedPacket.body.sourceHash !== packet.body.sourceHash ||
        savedPacket.body.noteId !== packet.body.noteId ||
        savedPacket.body.signedAt !== packet.body.signedAt ||
        savedDocument.additions !== expected.additions ||
        savedDocument.status !== (markReviewed ? 'reviewed' : 'draft') ||
        JSON.stringify(savedDocument.sourceSections) !== JSON.stringify(document.sourceSections)
      ) {
        setMessage(
          'The save could not be confirmed. Your doctor additions are still here. Retry or preserve them before reloading.',
        );
        return;
      }
      setEditor(editorFor(savedPacket, savedDocument));
      setAcknowledged(false);
      setReceipt(
        markReviewed
          ? 'Current wording reviewed and saved. This remains a draft, not issued.'
          : 'Doctor additions saved as a draft. Review is still required before draft download.',
      );
    } catch {
      if (mounted.current)
        setMessage('The save failed. Your doctor additions are still here. Retry saving.');
    } finally {
      lock.current = false;
      if (mounted.current) setWorking(false);
    }
  }
  async function download() {
    if (!canDownload || !packet || !document || lock.current) return;
    lock.current = true;
    setWorking(true);
    setMessage(null);
    setReceipt(null);
    try {
      const confirmed = await onDownload(packet, document);
      if (mounted.current && !confirmed)
        setMessage('The reviewed draft download could not be confirmed. Retry.');
    } catch {
      if (mounted.current) setMessage('The reviewed draft download failed. Retry.');
    } finally {
      lock.current = false;
      if (mounted.current) setWorking(false);
    }
  }

  return (
    <section className={styles.panel} aria-labelledby={`${id}-title`}>
      <header className={styles.header}>
        <div>
          <h2 id={`${id}-title`}>Documents from this consultation</h2>
          <p>
            Prepare separate drafts from the saved signed note. Review each document before
            downloading a draft. Nothing is issued, signed or shared here.
          </p>
        </div>
        <button type="button" className={styles.button} disabled={blocked} onClick={reload}>
          Reload documents
        </button>
      </header>
      <div className={styles.notices}>
        {loading && <p role="status">Loading consultation document drafts…</p>}
        {!loading && !state && (
          <p role="status">Document drafts could not be loaded. Reload to try again.</p>
        )}
        {state?.source.state === 'unsigned' && (
          <p role="status">
            Sign the clinical note first. Document drafts are prepared only from the saved signed
            note.
          </p>
        )}
        {state?.source.state === 'unavailable' && (
          <p role="status">
            The saved signed source is unavailable. Reload before preparing or reviewing document
            drafts.
          </p>
        )}
        {error && (
          <p className={styles.warning} role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className={styles.warning} role="alert">
            {message}
          </p>
        )}
        {receipt && <p role="status">{receipt}</p>}
        {pending && <p role="status">Working on the document draft…</p>}
      </div>
      <div className={styles.prepare}>
        <fieldset disabled={!ready || blocked} className={styles.typeChoices}>
          <legend>Choose document drafts</legend>
          {documentTypes.map((item) => (
            <label key={item.type}>
              <input
                type="checkbox"
                checked={types.includes(item.type)}
                onChange={(event) =>
                  setTypes(
                    event.target.checked
                      ? [...types, item.type]
                      : types.filter((value) => value !== item.type),
                  )
                }
              />
              <span>{item.label}</span>
            </label>
          ))}
        </fieldset>
        <button
          type="button"
          className={styles.primaryButton}
          disabled={
            !ready ||
            blocked ||
            !types.length ||
            (state?.packets.length ?? 0) >= SCRIBE_CONSULTATION_DOCUMENT_MAX_PACKETS
          }
          onClick={() => void create()}
        >
          Prepare selected drafts
        </button>
      </div>
      {ready && (state?.packets.length ?? 0) >= SCRIBE_CONSULTATION_DOCUMENT_MAX_PACKETS && (
        <p className={styles.limit}>
          This consultation has reached its {SCRIBE_CONSULTATION_DOCUMENT_MAX_PACKETS}-packet limit.
          Review an existing packet below.
        </p>
      )}
      {state && (
        <>
          {state.packets.length ? (
            <div className={styles.packetChoice}>
              <label htmlFor={`${id}-packet`}>Prepared packet</label>
              <select
                id={`${id}-packet`}
                disabled={blocked}
                value={packet?.id ?? ''}
                onChange={(event) => {
                  const next = state.packets.find((item) => item.id === event.target.value);
                  if (next?.body.documents[0]) select(next, next.body.documents[0]);
                }}
              >
                {!packet && <option value="">Select a packet</option>}
                {state.packets.map((item, index) => (
                  <option key={item.id} value={item.id}>
                    Packet {index + 1}:{' '}
                    {item.body.documents.map((doc) => title(doc.type)).join(', ')}
                    {item.sourceCurrent ? '' : ' (older source)'}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <p className={styles.empty}>
              No document drafts prepared yet. Choose the documents needed for this consultation.
            </p>
          )}
          {packet && document && editor && (
            <>
              <nav className={styles.documentTabs} aria-label="Documents in selected packet">
                {packet.body.documents.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={styles.tab}
                    disabled={blocked}
                    aria-pressed={item.id === document.id}
                    onClick={() => select(packet, item)}
                  >
                    {title(item.type)}
                  </button>
                ))}
              </nav>
              <article className={styles.document} aria-labelledby={`${id}-document-title`}>
                <header className={styles.documentHeader}>
                  <div>
                    <h3 id={`${id}-document-title`}>{title(document.type)}</h3>
                    <p className={styles.draftLabel}>Draft — not issued</p>
                  </div>
                  <p role="status" className={styles.reviewStatus}>
                    {reviewed
                      ? 'Current wording reviewed'
                      : dirty
                        ? 'Unsaved additions · review required'
                        : 'Draft · review required'}
                  </p>
                </header>
                {document.type === 'medical_certificate' && (
                  <p className={styles.warning} role="note">
                    <strong>Not valid for issue.</strong> This certificate draft does not infer
                    fitness, leave dates or recovery. A qualified clinician must determine and
                    complete any certification separately. Reviewing or downloading this draft does
                    not issue a certificate.
                  </p>
                )}
                {!sourceMatches && (
                  <p className={styles.warning} role="alert">
                    {ready
                      ? 'This packet uses an older signed source. It cannot be edited, reviewed or downloaded here. Prepare a new packet from the current signed note.'
                      : 'This packet is retained as read-only history. Its signed source cannot currently be confirmed. Editing, review and draft download are disabled.'}
                  </p>
                )}
                {changed && dirty && (
                  <p className={styles.warning} role="alert">
                    The saved packet changed. Your additions remain here, but saving is paused to
                    avoid overwriting another version. Preserve your wording before reloading.
                  </p>
                )}
                <section className={styles.source} aria-label="Read-only signed source sections">
                  <h4>From the saved signed note</h4>
                  <p className={styles.detail}>
                    These source sections are read-only. Doctor additions below do not change the
                    signed clinical note.
                  </p>
                  {document.sourceSections.map((section, index) => (
                    <div key={`${section.label}-${index}`} className={styles.sourceSection}>
                      <h5>{section.label}</h5>
                      <p>{section.text || 'No text recorded in this section.'}</p>
                    </div>
                  ))}
                  {document.sourceSections.length === 0 && (
                    <p className={styles.detail}>
                      {document.type === 'medical_certificate'
                        ? 'No certification statement has been generated. Complete any certificate particulars separately.'
                        : 'No source sections were included in this document draft.'}
                    </p>
                  )}
                </section>
                <ScribeDocumentTemplatePicker
                  key={`${packet.id}:${document.id}`}
                  documentType={document.type}
                  disabled={!canSave}
                  onAppend={(fields) => {
                    if (!canSave) return;
                    const next = editor.additions ? `${editor.additions}\n\n${fields}` : fields;
                    if (next.length > SCRIBE_CONSULTATION_DOCUMENT_MAX_ADDITIONS) {
                      setMessage(
                        'These fields would exceed the document limit. Shorten your additions before appending.',
                      );
                      return;
                    }
                    edit(next);
                  }}
                />
                <div className={styles.additions}>
                  <label htmlFor={`${id}-additions`}>Doctor additions</label>
                  <p id={`${id}-additions-help`} className={styles.detail}>
                    Add document-specific wording. Do not treat unconfirmed details as established
                    facts.
                  </p>
                  <textarea
                    id={`${id}-additions`}
                    aria-describedby={`${id}-additions-help`}
                    rows={7}
                    maxLength={SCRIBE_CONSULTATION_DOCUMENT_MAX_ADDITIONS}
                    value={editor.additions}
                    disabled={!canSave}
                    onChange={(event) => edit(event.target.value)}
                  />
                </div>
                {unfinished && (
                  <p role="status" className={styles.warning}>
                    Complete or remove every [[Complete: …]] field before reviewing this draft. You
                    can save unfinished work as a draft.
                  </p>
                )}
                <footer className={styles.footer}>
                  <label className={styles.acknowledgement}>
                    <input
                      type="checkbox"
                      checked={acknowledged}
                      disabled={!canSave || unfinished}
                      onChange={(event) => setAcknowledged(event.target.checked)}
                    />
                    <span>
                      I checked the signed source and this document’s current wording. This remains
                      a draft, not issued.
                    </span>
                  </label>
                  <div className={styles.actions}>
                    <button
                      type="button"
                      className={styles.button}
                      disabled={!canSave}
                      onClick={() => void save(false)}
                    >
                      Save draft additions
                    </button>
                    <button
                      type="button"
                      className={styles.primaryButton}
                      disabled={!canSave || !acknowledged || unfinished}
                      onClick={() => void save(true)}
                    >
                      Review current wording and save
                    </button>
                    <button
                      type="button"
                      className={styles.textButton}
                      disabled={!canDownload}
                      onClick={() => void download()}
                    >
                      Download reviewed draft
                    </button>
                  </div>
                  <p className={styles.detail}>
                    Download is available only for a reviewed, saved draft from the current signed
                    source. Downloading does not issue, sign or send it.
                  </p>
                </footer>
              </article>
            </>
          )}
        </>
      )}
    </section>
  );
}
