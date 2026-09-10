'use client';

import { useId, useRef, useState } from 'react';
import {
  MindCareRecordResponseSchema,
  type MindCareRecordBody,
  type MindCareRecordDto,
} from '@cureocity/contracts';
import { Button } from '../ui/Button';
import { useUnsavedWorkGuard } from '@/lib/use-unsaved-work-guard';

export const EMPTY_MIND_CARE_RECORD: MindCareRecordBody = {
  version: 'V1',
  agreement: {
    scope: '',
    confidentialityAndLimits: '',
    practicalArrangements: '',
    contactAndCrisisArrangements: '',
    clientPriorities: '',
    discussedOn: null,
    reviewOn: null,
  },
  clientVoice: {
    recordedOn: null,
    whatHelped: '',
    whatCouldChange: '',
    everydayChanges: '',
    clinicianReflection: '',
  },
  continuity: {
    stage: 'NOT_PLANNED',
    maintenancePlan: '',
    warningSignsAndResponse: '',
    endingOrReferralPlan: '',
    referralFollowThrough: '',
    reviewOn: null,
  },
};

export function MindCareRecordPanel({ clientId }: { clientId: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [record, setRecord] = useState<MindCareRecordDto | null>(null);
  const [latestVersion, setLatestVersion] = useState(0);
  const [body, setBody] = useState<MindCareRecordBody>(EMPTY_MIND_CARE_RECORD);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [versionToRead, setVersionToRead] = useState('');
  const attempt = useRef<{ fingerprint: string; operationId: string } | null>(null);
  const busyRef = useRef(false);
  const dirty =
    editing && JSON.stringify(body) !== JSON.stringify(record?.body ?? EMPTY_MIND_CARE_RECORD);
  const historical = (record?.version ?? 0) !== latestVersion;
  useUnsavedWorkGuard(
    dirty,
    'This care record has unsaved changes. Leave without saving them?',
    busy,
  );

  async function load(version?: number) {
    if (busyRef.current || dirty) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setReceipt(null);
    try {
      const response = await fetch(
        `/api/v1/clients/${clientId}/care-record${version ? `?version=${version}` : ''}`,
        { cache: 'no-store', signal: AbortSignal.timeout(20_000) },
      );
      const parsed = MindCareRecordResponseSchema.safeParse(await response.json());
      if (!response.ok || !parsed.success)
        throw new Error(
          'The care record could not be loaded. Retry before editing; saved records have not been replaced.',
        );
      setRecord(parsed.data.record);
      setLatestVersion(parsed.data.latestVersion);
      setBody(parsed.data.record?.body ?? EMPTY_MIND_CARE_RECORD);
      setLoaded(true);
      setEditing(false);
      attempt.current = null;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load the care record.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function save() {
    if (busyRef.current || !dirty || historical) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setReceipt(null);
    try {
      const payload = { expectedVersion: record?.version ?? 0, body };
      const fingerprint = JSON.stringify(payload);
      if (attempt.current?.fingerprint !== fingerprint)
        attempt.current = { fingerprint, operationId: crypto.randomUUID() };
      const response = await fetch(`/api/v1/clients/${clientId}/care-record`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...payload, operationId: attempt.current.operationId }),
        signal: AbortSignal.timeout(25_000),
      });
      const json: unknown = await response.json().catch(() => null);
      const parsed = MindCareRecordResponseSchema.safeParse(json);
      if (
        !response.ok ||
        !parsed.success ||
        parsed.data.record?.operationId !== attempt.current.operationId
      )
        throw new Error(
          response.status === 409
            ? 'A newer record or a conflicting save exists. Your draft is kept here. Copy any changes you need, then discard this draft and load the current version.'
            : 'The save could not be confirmed. Your draft is still here; retry the same save.',
        );
      setRecord(parsed.data.record);
      setBody(parsed.data.record.body);
      setLatestVersion(parsed.data.latestVersion);
      setEditing(false);
      setReceipt(
        `Version ${parsed.data.record.version} saved. No consent, discharge or sharing status changed.`,
      );
      attempt.current = null;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The save could not be confirmed.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  function update<K extends 'agreement' | 'clientVoice' | 'continuity'>(
    section: K,
    field: keyof MindCareRecordBody[K],
    value: string | null,
  ) {
    setBody((previous) => ({ ...previous, [section]: { ...previous[section], [field]: value } }));
  }
  const readonly = !editing || busy || historical;
  const textField = <K extends 'agreement' | 'clientVoice' | 'continuity'>(
    section: K,
    field: keyof MindCareRecordBody[K],
    label: string,
    hint?: string,
  ) => (
    <div className="space-y-1" key={`${section}-${String(field)}`}>
      <label htmlFor={`${id}-${section}-${String(field)}`} className="block text-sm font-medium">
        {label}
      </label>
      {hint && (
        <p className="max-w-2xl text-xs leading-relaxed text-[var(--color-ink-3)]">{hint}</p>
      )}
      {readonly ? (
        <p className="max-w-2xl whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-ink-2)]">
          {String(body[section][field] || 'Not recorded')}
        </p>
      ) : (
        <textarea
          id={`${id}-${section}-${String(field)}`}
          value={String(body[section][field] ?? '')}
          maxLength={2000}
          rows={3}
          onChange={(event) => update(section, field, event.target.value)}
          className="w-full max-w-2xl rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-3 text-sm"
        />
      )}
    </div>
  );
  const dateField = (
    section: 'agreement' | 'clientVoice' | 'continuity',
    field: 'discussedOn' | 'recordedOn' | 'reviewOn',
    label: string,
  ) => {
    const value = (body[section] as Record<string, string | null>)[field];
    return (
      <label className="block text-sm" htmlFor={`${id}-${section}-${field}`}>
        {label}
        {readonly ? (
          <span className="mt-1 block text-[var(--color-ink-2)]">{value || 'Not recorded'}</span>
        ) : (
          <input
            id={`${id}-${section}-${field}`}
            type="date"
            value={value ?? ''}
            onChange={(event) =>
              setBody((previous) => ({
                ...previous,
                [section]: { ...previous[section], [field]: event.target.value || null },
              }))
            }
            className="ml-3 rounded-lg border border-[var(--color-line)] p-2"
          />
        )}
      </label>
    );
  };

  return (
    <section
      className="mt-5 rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-5"
      aria-labelledby={`${id}-title`}
    >
      <button
        type="button"
        id={`${id}-title`}
        aria-expanded={open}
        aria-controls={`${id}-content`}
        disabled={dirty || busy}
        onClick={() => {
          setOpen(!open);
          if (!open && !loaded) void load();
        }}
        className="flex w-full items-center justify-between gap-4 text-left"
      >
        <span className="font-serif text-xl">Care agreement &amp; reviews</span>
        <span className="text-sm text-[var(--color-accent)]">{open ? 'Close' : 'Open'}</span>
      </button>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--color-ink-2)]">
        What you and the client discussed, how the work is helping, and what happens next. A living
        clinical record, separate from recording permissions.
      </p>
      {open && (
        <div id={`${id}-content`} className="mt-5 space-y-6">
          {busy && (
            <p role="status">{editing ? 'Saving your care record…' : 'Loading the care record…'}</p>
          )}
          {error && (
            <p role="alert" className="max-w-2xl text-sm text-[var(--color-warn)]">
              {error}
            </p>
          )}
          {!loaded && !busy && (
            <Button size="sm" variant="secondary" onClick={() => void load()}>
              Retry loading care record
            </Button>
          )}
          {loaded && (
            <>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <p>
                  {record
                    ? `${historical ? 'Historical' : 'Current'} version ${record.version} of ${latestVersion} · saved ${new Date(record.createdAt).toLocaleDateString()}`
                    : 'No care agreement or review recorded yet.'}
                </p>
                {!editing && !historical && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      setEditing(true);
                      setReceipt(null);
                    }}
                  >
                    {record ? 'Update care record' : 'Record what was discussed'}
                  </Button>
                )}
                {historical && (
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => void load()}>
                    Return to current version
                  </Button>
                )}
              </div>
              <section className="space-y-4" aria-labelledby={`${id}-agreement`}>
                <h3 id={`${id}-agreement`} className="text-base font-semibold">
                  Your counselling agreement
                </h3>
                <p className="max-w-2xl text-xs text-[var(--color-ink-3)]">
                  Record only what was actually discussed. Blank means not recorded, not agreed.
                  This does not capture or grant recording/AI consent.
                </p>
                {textField('agreement', 'scope', 'What the work will cover')}
                {textField('agreement', 'clientPriorities', 'What matters to this client')}
                {textField(
                  'agreement',
                  'confidentialityAndLimits',
                  'Confidentiality and its limits discussed',
                )}
                {textField(
                  'agreement',
                  'practicalArrangements',
                  'Session and practical arrangements',
                  'For example, frequency, duration and cancellation arrangements that you discussed.',
                )}
                {textField(
                  'agreement',
                  'contactAndCrisisArrangements',
                  'Contact and urgent-support arrangements discussed',
                  'Document your agreed boundaries and appropriate support arrangements; this field is not an emergency service.',
                )}
                <div className="flex flex-wrap gap-5">
                  {dateField('agreement', 'discussedOn', 'Discussed on')}
                  {dateField('agreement', 'reviewOn', 'Review agreement on')}
                </div>
              </section>
              <details className="border-t border-[var(--color-line-soft)] pt-4">
                <summary className="cursor-pointer py-2 text-base font-semibold">
                  Client voice &amp; reflection
                </summary>
                <div className="mt-3 space-y-4">
                  <p className="max-w-2xl text-xs text-[var(--color-ink-3)]">
                    An informal conversation, not a validated questionnaire or outcome score.
                    Distinguish the client’s feedback from your own reflection. Earlier entries
                    remain in saved versions.
                  </p>
                  {dateField('clientVoice', 'recordedOn', 'Feedback discussed on')}
                  {textField('clientVoice', 'whatHelped', 'What the client said helped')}
                  {textField(
                    'clientVoice',
                    'whatCouldChange',
                    'What the client wants done differently',
                  )}
                  {textField(
                    'clientVoice',
                    'everydayChanges',
                    'Changes in everyday life, in the client’s account',
                  )}
                  {textField(
                    'clientVoice',
                    'clinicianReflection',
                    'Your reflection and response to the feedback',
                  )}
                </div>
              </details>
              <details className="border-t border-[var(--color-line-soft)] pt-4">
                <summary className="cursor-pointer py-2 text-base font-semibold">
                  Continuing, ending or referring
                </summary>
                <div className="mt-3 space-y-4">
                  <p className="max-w-2xl text-xs text-[var(--color-ink-3)]">
                    A plan for discussion and follow-through. Saving here never discharges,
                    transfers, refers or contacts the client. Use the separate clinical action when
                    appropriate.
                  </p>
                  <label className="block text-sm" htmlFor={`${id}-stage`}>
                    Where the planning stands
                    <select
                      id={`${id}-stage`}
                      disabled={readonly}
                      value={body.continuity.stage}
                      onChange={(event) => update('continuity', 'stage', event.target.value)}
                      className="ml-3 rounded-lg border border-[var(--color-line)] p-2"
                    >
                      <option value="NOT_PLANNED">Not recorded</option>
                      <option value="DISCUSSING">Being discussed</option>
                      <option value="AGREED">Plan agreed with the client</option>
                    </select>
                  </label>
                  {textField(
                    'continuity',
                    'maintenancePlan',
                    'What will help the client maintain progress',
                  )}
                  {textField(
                    'continuity',
                    'warningSignsAndResponse',
                    'Signs to revisit and the agreed response',
                  )}
                  {textField(
                    'continuity',
                    'endingOrReferralPlan',
                    'Ending or referral plan, if appropriate',
                  )}
                  {textField(
                    'continuity',
                    'referralFollowThrough',
                    'Referral follow-through',
                    'Record what is known: who will follow up, whether an appointment or acceptance is confirmed, and what remains unconfirmed.',
                  )}
                  {dateField('continuity', 'reviewOn', 'Follow up or review on')}
                </div>
              </details>
              {editing && (
                <div className="flex flex-wrap gap-3 border-t border-[var(--color-line-soft)] pt-4">
                  <Button
                    size="sm"
                    disabled={busy || !dirty || historical}
                    onClick={() => void save()}
                  >
                    Save reviewed version
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      setBody(record?.body ?? EMPTY_MIND_CARE_RECORD);
                      setEditing(false);
                      setError(null);
                      attempt.current = null;
                    }}
                  >
                    Discard unsaved draft
                  </Button>
                </div>
              )}
              {receipt && (
                <p role="status" className="text-sm text-[var(--color-ink-2)]">
                  {receipt}
                </p>
              )}
              {!editing && latestVersion > 0 && (
                <div className="flex flex-wrap items-end gap-3 border-t border-[var(--color-line-soft)] pt-4">
                  <label htmlFor={`${id}-version`} className="text-xs">
                    Read an earlier version (1–{latestVersion})
                    <input
                      id={`${id}-version`}
                      type="number"
                      min={1}
                      max={latestVersion}
                      value={versionToRead}
                      onChange={(event) => setVersionToRead(event.target.value)}
                      className="ml-3 w-20 rounded-lg border border-[var(--color-line)] p-2"
                    />
                  </label>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={
                      busy ||
                      !Number.isInteger(Number(versionToRead)) ||
                      Number(versionToRead) < 1 ||
                      Number(versionToRead) > latestVersion
                    }
                    onClick={() => void load(Number(versionToRead))}
                  >
                    Read saved version
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => void load()}>
                    Reload current version
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
