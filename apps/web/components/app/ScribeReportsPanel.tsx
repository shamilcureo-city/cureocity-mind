'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReportCandidate, ReportSummary } from '@/lib/scribe-report-schema';
import type { ScribeRecord } from '@/lib/scribe-workspace-store';
import styles from './ScribeDocumentReview.module.css';
import { useScribeFetch } from './ScribeTransport';
import type { ReportListPage } from '@/lib/scribe-report-pagination';

type ReportRecord = ScribeRecord<ReportSummary>;
type Props = { clientId: string; sessionId?: string };

export function ScribeReportsPanel(props: Props) {
  return <ReportsWorkspace key={`${props.clientId}:${props.sessionId ?? ''}`} {...props} />;
}

async function result<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? 'Could not complete the request. Try again.');
  return body;
}

function ReportsWorkspace({ clientId, sessionId }: Props) {
  const fetch = useScribeFetch();
  const [records, setRecords] = useState<ReportRecord[]>([]);
  const [selected, setSelected] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [listReady, setListReady] = useState(false);
  const [listAttempt, setListAttempt] = useState(0);
  const query = new URLSearchParams({ clientId, ...(sessionId ? { sessionId } : {}) }).toString();
  const endpoint = `/api/v1/scribe/reports?${query}`;

  useEffect(() => {
    const controller = new AbortController();
    void fetch(endpoint, { cache: 'no-store', signal: controller.signal })
      .then(result<ReportListPage>)
      .then((data) => {
        if (controller.signal.aborted) return;
        setRecords(data.records);
        setSelected(data.records[0]?.id ?? '');
        setNextCursor(data.nextCursor ?? null);
        setListReady(true);
        setLoaded(true);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : 'Could not load reports.');
          setLoaded(true);
        }
      });
    return () => controller.abort();
  }, [endpoint, fetch, listAttempt]);

  async function loadOlder() {
    if (!nextCursor || busy) return;
    setBusy(true);
    setError('');
    try {
      const data = await result<ReportListPage>(
        await fetch(`${endpoint}&cursor=${encodeURIComponent(nextCursor)}`, { cache: 'no-store' }),
      );
      setRecords((current) => {
        const seen = new Set(current.map((row) => row.id));
        return [...current, ...data.records.filter((row) => !seen.has(row.id))];
      });
      setNextCursor(data.nextCursor ?? null);
    } catch (cause) {
      // Keep the cursor and current review so a failed page can be retried safely.
      setError(cause instanceof Error ? cause.message : 'Could not load older reports. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function upload() {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const form = new FormData();
      form.set('file', file);
      const data = await result<{ record: ReportRecord }>(
        await fetch(endpoint, { method: 'POST', body: form }),
      );
      setRecords((current) => [data.record, ...current]);
      setSelected(data.record.id);
      setFile(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Report processing failed.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(record: ReportRecord) {
    if (
      !window.confirm(
        'Delete this saved report, including its original and reviewed values? This cannot be undone.',
      )
    )
      return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/v1/scribe/reports/${record.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: record.revision }),
      });
      if (!response.ok) await result(response);
      setRecords((current) => current.filter((row) => row.id !== record.id));
      setSelected('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete the report.');
    } finally {
      setBusy(false);
    }
  }

  const record = records.find((row) => row.id === selected);
  return (
    <section className={styles.panel} aria-label="Report review">
      <header>
        <h3>Review a lab report</h3>
        <p className={styles.description}>
          Upload a PDF or photo, then check each candidate against the original. Confirmed results
          stay in the report record; they do not change medicines, diagnoses or live vitals.
        </p>
      </header>
      <div className={styles.toolbar}>
        <label>
          Report file
          <input
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            disabled={busy}
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>
        <button type="button" disabled={!file || busy || !loaded} onClick={() => void upload()}>
          {busy ? 'Processing…' : 'Extract candidate values'}
        </button>
      </div>
      <p className={styles.status}>
        One PDF (up to 5 pages), JPEG or PNG; maximum 2 MB. AI and processing consent required.
        Check patient identity before use.
      </p>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {!loaded && <p role="status">Loading saved reports…</p>}
      {loaded && !listReady && (
        <button
          type="button"
          className={styles.secondary}
          disabled={busy}
          onClick={() => {
            setError('');
            setLoaded(false);
            setListAttempt((attempt) => attempt + 1);
          }}
        >
          Retry loading saved reports
        </button>
      )}
      {records.length > 0 && (
        <label>
          Saved reports
          <select
            value={selected}
            disabled={busy}
            onChange={(event) => setSelected(event.target.value)}
          >
            <option value="">Choose a report</option>
            {records.map((row) => (
              <option key={row.id} value={row.id}>
                {row.body.original.name} —{' '}
                {row.body.status === 'confirmed' ? 'Doctor confirmed' : 'Needs review'}
              </option>
            ))}
          </select>
        </label>
      )}
      {listReady && (
        <div className={styles.toolbar}>
          <p className={styles.status}>
            {records.length} saved report(s) loaded{nextCursor ? '; older reports available.' : '.'}
          </p>
          {nextCursor && (
            <button
              type="button"
              className={styles.secondary}
              disabled={busy}
              onClick={() => void loadOlder()}
            >
              {busy ? 'Loading…' : 'Load older reports'}
            </button>
          )}
        </div>
      )}
      {record && (
        <ReportReview
          key={`${record.id}:${record.revision}`}
          fetcher={fetch}
          record={record}
          busy={busy}
          onRemove={() => void remove(record)}
          onSave={async (candidates) => {
            setBusy(true);
            setError('');
            try {
              const data = await result<{ record: ReportRecord }>(
                await fetch(`/api/v1/scribe/reports/${record.id}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    revision: record.revision,
                    candidates,
                    originalReviewed: true,
                    patientMatched: true,
                  }),
                }),
              );
              setRecords((current) =>
                current.map((row) => (row.id === record.id ? data.record : row)),
              );
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : 'Could not save the review.');
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </section>
  );
}

function ReportReview({
  record,
  busy,
  onSave,
  onRemove,
  fetcher,
}: {
  record: ReportRecord;
  busy: boolean;
  onSave: (rows: ReportCandidate[]) => Promise<void>;
  onRemove: () => void;
  fetcher: typeof fetch;
}) {
  const [candidates, setCandidates] = useState(record.body.candidates);
  const [patientMatched, setPatientMatched] = useState(false);
  const [originalReviewed, setOriginalReviewed] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewError, setPreviewError] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const opened = Boolean(previewUrl);
  const source = `/api/v1/scribe/reports/${record.id}/original`;
  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );
  async function preview() {
    setPreviewLoading(true);
    setPreviewError('');
    try {
      const response = await fetcher(source, { cache: 'no-store' });
      if (!response.ok) await result(response);
      if (
        response.headers.get('content-type')?.split(';')[0]?.trim() !== record.body.original.mime
      ) {
        throw new Error('Unexpected original report type');
      }
      const blob = await response.blob();
      if (alive.current) setPreviewUrl(URL.createObjectURL(blob));
    } catch {
      setPreviewError('Could not open the original. Retry before confirming any results.');
    } finally {
      setPreviewLoading(false);
    }
  }
  function edit(id: string, patch: Partial<ReportCandidate>) {
    setCandidates((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
    setDirty(true);
    setOriginalReviewed(false);
    setPatientMatched(false);
  }
  return (
    <>
      {record.body.status === 'confirmed' && !dirty && (
        <p role="status" className={styles.notice}>
          Doctor confirmed on {new Date(record.body.reviewedAt!).toLocaleString()}. Editing requires
          another review.
        </p>
      )}
      <div className={styles.split}>
        <div className={styles.original}>
          <h4>Original report</h4>
          <p className={styles.status}>
            {record.body.original.name} · {record.body.original.pages} page(s)
          </p>
          <button
            type="button"
            disabled={previewLoading}
            className={styles.secondary}
            onClick={() => void preview()}
          >
            {previewLoading ? 'Opening original…' : 'Show original for review'}
          </button>
          {previewError && (
            <p role="alert" className={styles.error}>
              {previewError}
            </p>
          )}
          {opened &&
            (record.body.original.mime === 'application/pdf' ? (
              <iframe
                title="Original lab report"
                src={previewUrl}
                className={styles.preview}
                sandbox=""
              />
            ) : (
              // Authenticated original file endpoint; not a public image URL or an optimized image cache.
              <img src={previewUrl} alt="Original uploaded lab report" className={styles.preview} />
            ))}
          {opened && (
            <a href={previewUrl} target="_blank" rel="noopener noreferrer">
              Open original in a new tab
            </a>
          )}
        </div>
        <div className={styles.rows}>
          {candidates.map((row, index) => (
            <fieldset key={row.id} disabled={busy} className={styles.row}>
              <legend>
                Result {index + 1} · page {row.page}
              </legend>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={row.included}
                  onChange={(event) => edit(row.id, { included: event.target.checked })}
                />
                Keep this result in the reviewed report
              </label>
              <div className={styles.fields}>
                {(['name', 'value', 'unit', 'reportDate'] as const).map((field) => (
                  <label key={field}>
                    {
                      {
                        name: 'Test',
                        value: 'Value',
                        unit: 'Unit',
                        reportDate: 'Report / collection date',
                      }[field]
                    }
                    <input
                      value={row[field]}
                      maxLength={field === 'unit' || field === 'reportDate' ? 80 : 160}
                      onChange={(event) => edit(row.id, { [field]: event.target.value })}
                    />
                  </label>
                ))}
              </div>
              <blockquote className={styles.source}>
                Extracted evidence: {row.sourceText}
              </blockquote>
            </fieldset>
          ))}
        </div>
      </div>
      <div className={styles.review}>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={patientMatched}
            disabled={busy || !opened}
            onChange={(event) => setPatientMatched(event.target.checked)}
          />
          I checked the original belongs to this patient.
        </label>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={originalReviewed}
            disabled={busy || !opened}
            onChange={(event) => setOriginalReviewed(event.target.checked)}
          />
          I checked every included value, date and unit against the original and excluded anything
          uncertain.
        </label>
        <div className={styles.toolbar}>
          <button
            type="button"
            disabled={
              busy ||
              !patientMatched ||
              !originalReviewed ||
              candidates.some((row) => !row.name.trim())
            }
            onClick={() => void onSave(candidates)}
          >
            Confirm reviewed report
          </button>
          <button type="button" disabled={busy} className={styles.secondary} onClick={onRemove}>
            Delete report
          </button>
        </div>
      </div>
    </>
  );
}
