'use client';

import { useEffect, useRef, useState } from 'react';
import {
  INSTRUCTION_LANGUAGES,
  instructionWordingPreservesFacts,
  type InstructionLanguage,
  type InstructionsBody,
} from '@/lib/scribe-instructions-schema';
import type { ScribeRecord } from '@/lib/scribe-workspace-store';
import styles from './ScribeDocumentReview.module.css';
import { useScribeFetch } from './ScribeTransport';

type InstructionRecord = ScribeRecord<InstructionsBody> & { sourceCurrent: boolean };
type Props = { sessionId: string; clientId?: string };
export function ScribePatientInstructions(props: Props) {
  return (
    <InstructionsWorkspace
      key={`${props.clientId ?? ''}:${props.sessionId}`}
      sessionId={props.sessionId}
    />
  );
}

async function result<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? 'Could not complete the request. Try again.');
  return body;
}
function InstructionsWorkspace({ sessionId }: { sessionId: string }) {
  const fetch = useScribeFetch();
  const [records, setRecords] = useState<InstructionRecord[]>([]);
  const [selected, setSelected] = useState('');
  const [language, setLanguage] = useState<InstructionLanguage>('source');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/v1/scribe/instructions?sessionId=${encodeURIComponent(sessionId)}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(result<{ records: InstructionRecord[] }>)
      .then((data) => {
        setRecords(data.records);
        setSelected(data.records[0]?.id ?? '');
        setLoaded(true);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : 'Could not load instructions.');
          setLoaded(true);
        }
      });
    return () => controller.abort();
  }, [sessionId, fetch]);
  async function draft() {
    setBusy(true);
    setError('');
    try {
      const data = await result<{ record: InstructionRecord }>(
        await fetch('/api/v1/scribe/instructions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, language }),
        }),
      );
      setRecords((current) => [data.record, ...current]);
      setSelected(data.record.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not prepare instructions.');
    } finally {
      setBusy(false);
    }
  }
  const record = records.find((row) => row.id === selected);
  return (
    <section className={styles.panel} aria-label="Patient instruction review">
      <header>
        <h3>Patient instructions</h3>
        <p className={styles.description}>
          Prepare clear instructions from the locked signed prescription: confirmed medicines,
          advice, investigations and follow-up. No new medicine, dose or clock time is inferred.
          Nothing is sent automatically.
        </p>
      </header>
      <div className={styles.toolbar}>
        <label>
          Advice and follow-up language
          <select
            value={language}
            disabled={busy}
            onChange={(event) => setLanguage(event.target.value as InstructionLanguage)}
          >
            {Object.entries(INSTRUCTION_LANGUAGES).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" disabled={busy || !loaded} onClick={() => void draft()}>
          {busy ? 'Preparing…' : 'Prepare draft instructions'}
        </button>
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {!loaded && <p role="status">Checking signed source…</p>}
      {records.length > 0 && (
        <label>
          Saved instructions
          <select
            value={selected}
            disabled={busy}
            onChange={(event) => setSelected(event.target.value)}
          >
            <option value="">Choose a version</option>
            {records.map((row) => (
              <option key={row.id} value={row.id}>
                {INSTRUCTION_LANGUAGES[row.body.language]} —{' '}
                {!row.sourceCurrent
                  ? 'Source changed'
                  : row.body.status === 'reviewed'
                    ? 'Doctor reviewed'
                    : 'Needs review'}
              </option>
            ))}
          </select>
        </label>
      )}
      {record && (
        <InstructionsReview
          key={`${record.id}:${record.revision}`}
          record={record}
          busy={busy}
          onDownload={async () => {
            setBusy(true);
            setError('');
            try {
              const response = await fetch(`/api/v1/scribe/instructions/${record.id}/text`, {
                cache: 'no-store',
              });
              if (!response.ok) await result(response);
              const blob = await response.blob();
              if (!alive.current) return;
              const url = URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.href = url;
              link.download = 'reviewed-patient-instructions.txt';
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : 'Could not download instructions.');
            } finally {
              setBusy(false);
            }
          }}
          onSave={async (lines) => {
            setBusy(true);
            setError('');
            try {
              const data = await result<{ record: InstructionRecord }>(
                await fetch(`/api/v1/scribe/instructions/${record.id}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    revision: record.revision,
                    lines,
                    clinicalReviewed: true,
                    languageReviewed: true,
                  }),
                }),
              );
              setRecords((current) =>
                current.map((row) => (row.id === record.id ? data.record : row)),
              );
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : 'Could not confirm instructions.');
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </section>
  );
}

function InstructionsReview({
  record,
  busy,
  onSave,
  onDownload,
}: {
  record: InstructionRecord;
  busy: boolean;
  onSave: (lines: Array<{ id: string; text: string }>) => Promise<void>;
  onDownload: () => Promise<void>;
}) {
  const [lines, setLines] = useState(record.body.lines);
  const [clinicalReviewed, setClinicalReviewed] = useState(false);
  const [languageReviewed, setLanguageReviewed] = useState(false);
  const [dirty, setDirty] = useState(false);
  const factsChanged = lines.some((line) => !instructionWordingPreservesFacts(line, line.text));
  return (
    <>
      <p className={styles.status}>
        Signed source: {new Date(record.body.signedAt).toLocaleString()}. Language:{' '}
        {INSTRUCTION_LANGUAGES[record.body.language]}.
      </p>
      {!record.sourceCurrent && (
        <p role="alert" className={styles.notice}>
          The signed source changed. Prepare and review a new version; this version cannot be used.
        </p>
      )}
      {dirty && (
        <p role="status" className={styles.status}>
          Wording changes are not saved. Review clinical accuracy and language again before
          confirming.
        </p>
      )}
      {factsChanged && (
        <p role="alert" className={styles.error}>
          Keep medicine names, numbers, dose units and schedule order exactly as signed. Change
          treatment in the prescription, then sign it again.
        </p>
      )}
      <p className={styles.notice}>
        Medication instructions stay exactly as signed and cannot be translated or edited here.
        Review the translated advice, investigations and follow-up for accuracy. To change
        treatment, update the prescription and sign it again. A translation is not a new
        prescription.
      </p>
      <div className={styles.rows}>
        {lines.map((line) => (
          <div key={line.id} className={styles.row}>
            <h4>
              {
                {
                  medication: 'Medication schedule',
                  advice: 'Advice',
                  investigation: 'Investigation',
                  followup: 'Follow-up',
                }[line.kind]
              }
            </h4>
            <div className={styles.languageRow}>
              <div>
                <p className={styles.status}>Exact signed wording</p>
                <p className={styles.source}>{line.source}</p>
              </div>
              <label>
                {line.kind === 'medication' ? 'Medication wording (read-only)' : 'Patient wording'}
                <textarea
                  value={line.text}
                  maxLength={2000}
                  disabled={busy || !record.sourceCurrent}
                  readOnly={line.kind === 'medication'}
                  onChange={(event) => {
                    setLines((current) =>
                      current.map((row) =>
                        row.id === line.id ? { ...row, text: event.target.value } : row,
                      ),
                    );
                    setDirty(true);
                    setClinicalReviewed(false);
                    setLanguageReviewed(false);
                  }}
                />
              </label>
            </div>
          </div>
        ))}
      </div>
      <div className={styles.review}>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={clinicalReviewed}
            disabled={busy || !record.sourceCurrent}
            onChange={(event) => setClinicalReviewed(event.target.checked)}
          />
          I checked every instruction against the signed prescription. No medicine, dose, schedule
          or treatment has been added or changed.
        </label>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={languageReviewed}
            disabled={busy || !record.sourceCurrent}
            onChange={(event) => setLanguageReviewed(event.target.checked)}
          />
          I can verify this language and have reviewed the patient wording for accuracy and clarity.
        </label>
        <div className={styles.toolbar}>
          <button
            type="button"
            disabled={
              busy ||
              !record.sourceCurrent ||
              !clinicalReviewed ||
              !languageReviewed ||
              factsChanged ||
              lines.some((line) => !line.text.trim())
            }
            onClick={() => void onSave(lines.map(({ id, text }) => ({ id, text })))}
          >
            Confirm reviewed instructions
          </button>
          {record.body.status === 'reviewed' && !dirty && !factsChanged && record.sourceCurrent && (
            <button
              type="button"
              disabled={busy}
              className={styles.secondary}
              onClick={() => void onDownload()}
            >
              Download reviewed instructions
            </button>
          )}
        </div>
        {record.body.status === 'reviewed' && !dirty && (
          <p role="status" className={styles.status}>
            Clinical and language review saved. Download rechecks the signed source and sharing
            permission; nothing is sent.
          </p>
        )}
      </div>
    </>
  );
}
