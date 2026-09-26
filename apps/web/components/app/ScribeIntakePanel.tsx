'use client';

import { useCallback, useEffect, useState } from 'react';
import { intakeVitalsText, type ScribeIntakeRecord } from '@/lib/scribe-intake-contracts';
import { Button } from '../ui/Button';
import { CheckboxRow, Input, Textarea } from '../ui/Field';
import { useScribeFetch } from './ScribeTransport';

export function ScribeIntakePanel({ clientId }: { clientId: string }) {
  const request = useScribeFetch();
  const [saved, setSaved] = useState<{ clientId: string; items: ScribeIntakeRecord[] } | null>(
    null,
  );
  const items = saved?.clientId === clientId ? saved.items : [];
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [savedLink, setSavedLink] = useState<{ clientId: string; link: string } | null>(null);
  const link = savedLink?.clientId === clientId ? savedLink.link : null;
  const [copied, setCopied] = useState(false);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const response = await request(`/api/v1/clients/${clientId}/scribe-intake`, {
        signal,
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('Could not load staged intake.');
      const body = (await response.json()) as { items: ScribeIntakeRecord[] };
      if (!signal?.aborted) {
        setSaved({ clientId, items: body.items });
        setLoaded(true);
      }
    },
    [clientId, request],
  );
  useEffect(() => {
    const controller = new AbortController();
    setSaved(null);
    setLoaded(false);
    setSavedLink(null);
    setError(null);
    void load(controller.signal).catch((reason: Error) => {
      if (!controller.signal.aborted) setError(reason.message);
    });
    return () => controller.abort();
  }, [load]);
  async function create() {
    setBusy(true);
    setError(null);
    setSavedLink(null);
    setCopied(false);
    try {
      const response = await request(`/api/v1/clients/${clientId}/scribe-intake`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expiresInHours: 24 }),
      });
      if (!response.ok) throw new Error('Could not create intake link.');
      const body = (await response.json()) as { linkPath: string };
      setSavedLink({ clientId, link: new URL(body.linkPath, window.location.origin).toString() });
      await load();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function review(
    record: ScribeIntakeRecord,
    action: 'reviewed' | 'rejected' | 'revoke',
    note = '',
  ) {
    setBusy(true);
    setError(null);
    try {
      const response = await request(`/api/v1/clients/${clientId}/scribe-intake/${record.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedRevision: record.revision, action, note }),
      });
      if (!response.ok)
        throw new Error(
          response.status === 409
            ? 'Submission changed elsewhere. Review the refreshed version before retrying.'
            : 'Could not save review.',
        );
      if (action === 'revoke') setSavedLink(null);
      await load();
    } catch (reason) {
      setError((reason as Error).message);
      await load().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      id="scribe-intake"
      className="mt-6 space-y-3 rounded-2xl border border-[var(--color-line)] bg-white p-5"
      aria-label="Previsit intake"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-serif text-xl">Previsit intake</h2>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setError(null);
              void load().catch((reason: Error) => setError(reason.message));
            }}
          >
            Refresh
          </Button>
          <Button size="sm" disabled={busy} onClick={() => void create()}>
            Create 24-hour intake link
          </Button>
        </div>
      </div>
      <p className="text-sm text-[var(--color-ink-3)]">
        Give a single-use link to this patient, caregiver or clinic staff. It allows submission
        only, never chart access. Names and roles are self-reported. Review and reconcile before
        using information in care; reviewing here does not alter notes, prescriptions or allergies.
      </p>
      {error && (
        <p role="alert" className="text-sm text-[var(--color-warn)]">
          {error}
        </p>
      )}
      {link && (
        <div className="space-y-2 rounded-xl bg-[var(--color-accent-soft)] p-3">
          <label className="text-sm">
            Private link — copy now; it cannot be retrieved later
            <Input readOnly value={link} onFocus={(event) => event.target.select()} />
          </label>
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              void navigator.clipboard
                .writeText(link)
                .then(() => setCopied(true))
                .catch(() => setError('Copy unavailable. Select and copy the link manually.'))
            }
          >
            {copied ? 'Copied' : 'Copy private link'}
          </Button>
          <p className="text-xs">
            Anyone holding this link can submit once. Confirm the recipient before sharing.
          </p>
        </div>
      )}
      {!loaded ? (
        <p role="status">{error ? 'Intake unavailable.' : 'Loading intake…'}</p>
      ) : items.length === 0 ? (
        <p className="text-sm">No intake links or submissions yet.</p>
      ) : (
        items.map((record) => (
          <IntakeItem
            key={`${record.id}:${record.revision}`}
            record={record}
            busy={busy}
            onReview={review}
          />
        ))
      )}
    </section>
  );
}

function IntakeItem({
  record,
  busy,
  onReview,
}: {
  record: ScribeIntakeRecord;
  busy: boolean;
  onReview: (
    record: ScribeIntakeRecord,
    action: 'reviewed' | 'rejected' | 'revoke',
    note?: string,
  ) => Promise<void>;
}) {
  const [checked, setChecked] = useState(false);
  const [note, setNote] = useState('');
  const { report, review, submittedAt, expiresAt, revokedAt } = record.body;
  return (
    <div className="space-y-2 rounded-xl border border-[var(--color-line-soft)] p-4">
      <p className="text-sm font-medium">
        {report
          ? `Submitted ${new Date(submittedAt!).toLocaleString('en-IN')} · ${review.status}`
          : revokedAt
            ? 'Link revoked'
            : `Awaiting submission · expires ${new Date(expiresAt).toLocaleString('en-IN')}`}
      </p>
      {report && (
        <>
          <p className="text-xs text-[var(--color-warn)]">
            Unverified author: {report.authorName} · self-reported {report.authorRole}. Doctor
            review does not verify the submitter’s identity.
          </p>
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="font-medium">Reason for visit</dt>
              <dd className="whitespace-pre-wrap">{report.reasonForVisit}</dd>
            </div>
            <div>
              <dt className="font-medium">Reported medication use</dt>
              <dd className="whitespace-pre-wrap">{report.medications || 'Not supplied'}</dd>
            </div>
            <div>
              <dt className="font-medium">Reported allergies</dt>
              <dd>
                {report.allergyStatus === 'unknown'
                  ? 'Unknown / not sure'
                  : report.allergyStatus === 'none_reported'
                    ? 'Submitter reports none — confirm with patient'
                    : report.allergies}
              </dd>
            </div>
            <div>
              <dt className="font-medium">Reported history / readings</dt>
              <dd className="whitespace-pre-wrap">{report.history || 'Not supplied'}</dd>
            </div>
          </dl>
          {report.vitals && (
            <p className="text-sm">
              Self-reported readings — unverified; not added to chart:{' '}
              {intakeVitalsText(report.vitals)} · measured{' '}
              {new Date(report.vitals.measuredAt).toLocaleString('en-IN')}
            </p>
          )}
          {review.status === 'pending' ? (
            <>
              <label className="block text-sm">
                Doctor reconciliation note (staged only)
                <Textarea
                  value={note}
                  maxLength={2000}
                  onChange={(event) => setNote(event.target.value)}
                />
              </label>
              <CheckboxRow
                id={`intake-review-${record.id}`}
                checked={checked}
                onChange={setChecked}
                label="I have read and reconciled this submission; clinical chart changes are separate."
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={busy || !checked}
                  onClick={() => void onReview(record, 'reviewed', note)}
                >
                  Record doctor review
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy || !checked}
                  onClick={() => void onReview(record, 'rejected', note)}
                >
                  Reject submission
                </Button>
              </div>
            </>
          ) : (
            <p className="whitespace-pre-wrap text-sm">
              Doctor {review.status} this on {new Date(review.reviewedAt!).toLocaleString('en-IN')}.
              {review.note ? ` ${review.note}` : ''}
            </p>
          )}
        </>
      )}
      {!report && !revokedAt && (
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => void onReview(record, 'revoke')}
        >
          Revoke link
        </Button>
      )}
    </div>
  );
}
