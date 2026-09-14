'use client';

import { useEffect, useId, useRef, useState } from 'react';
import {
  MindCareRecordResponseSchema,
  MindCareRecordBodySchema,
  MindSessionWorkSchema,
  type MindCareRecordBody,
  type MindCareRecordDto,
  type MindSessionWork,
} from '@cureocity/contracts';
import Link from 'next/link';
import { Button } from '../ui/Button';
import { useUnsavedWorkGuard } from '@/lib/use-unsaved-work-guard';
import { MIND_WORK_LABELS, formatMindWorkDate } from '@/lib/mind-session-work';
import { useMindCloseoutTaskStatus } from '@/lib/mind-closeout-task-status';

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

type WorkDraft = {
  disposition: MindSessionWork['disposition'] | '';
  workDone: string;
  clientResponse: string;
};
const emptyWork = (): WorkDraft => ({ disposition: '', workDone: '', clientResponse: '' });
const workDraftFor = (work: MindSessionWork | undefined, sessionId?: string): WorkDraft =>
  work && work.sessionId === sessionId
    ? {
        disposition: work.disposition,
        workDone: work.workDone,
        clientResponse: work.clientResponse,
      }
    : emptyWork();

export function MindCareRecordPanel({
  clientId: requestedClientId,
  sessionContext: requestedSessionContext,
  embedded = false,
}: {
  clientId: string;
  sessionContext?: { sessionId: string; scheduledAt: string };
  /** The closeout task supplies the disclosure, while this editor stays mounted. */
  embedded?: boolean;
}) {
  // Bind every draft, receipt and request to the context in which it was opened. A parent
  // prop change must neither display its text under another client nor silently discard it.
  const [boundContext, setBoundContext] = useState(() => ({
    clientId: requestedClientId,
    sessionContext: requestedSessionContext,
  }));
  const { clientId, sessionContext } = boundContext;
  const contextMatches =
    clientId === requestedClientId &&
    sessionContext?.sessionId === requestedSessionContext?.sessionId &&
    sessionContext?.scheduledAt === requestedSessionContext?.scheduledAt;
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
  const [workDraft, setWorkDraft] = useState<WorkDraft>(emptyWork);
  const [uncertainSave, setUncertainSave] = useState(false);
  const [conflict, setConflict] = useState(false);
  const attempt = useRef<{
    expectedVersion: number;
    body: MindCareRecordBody;
    operationId: string;
  } | null>(null);
  const busyRef = useRef(false);
  const dirty =
    editing &&
    (sessionContext
      ? JSON.stringify(workDraft) !==
        JSON.stringify(workDraftFor(record?.body.sessionWork, sessionContext.sessionId))
      : JSON.stringify(body) !== JSON.stringify(record?.body ?? EMPTY_MIND_CARE_RECORD));
  const historical = (record?.version ?? 0) !== latestVersion;
  useMindCloseoutTaskStatus({
    dirty,
    busy: busy && editing,
    needsAttention: !!error || conflict || !contextMatches,
    uncertain: uncertainSave && !busy,
  });
  useUnsavedWorkGuard(
    dirty,
    'This care record has unsaved changes. Leave without saving them?',
    busy,
  );

  useEffect(() => {
    // Embedded closeout owns visibility; this initial read never resets an editor
    // when the user opens another optional task or a server refresh arrives.
    if (embedded) void load();
    // The panel is keyed to its session by its parent; load only on initial embedding.
  }, [embedded]);

  async function load(version?: number) {
    if (!contextMatches || busyRef.current || dirty) return;
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
      if (
        !response.ok ||
        !parsed.success ||
        (parsed.data.record && parsed.data.record.clientId !== clientId)
      )
        throw new Error(
          'The care record could not be loaded. Retry before editing; saved records have not been replaced.',
        );
      setRecord(parsed.data.record);
      setLatestVersion(parsed.data.latestVersion);
      setBody(parsed.data.record?.body ?? EMPTY_MIND_CARE_RECORD);
      setWorkDraft(workDraftFor(parsed.data.record?.body.sessionWork, sessionContext?.sessionId));
      setLoaded(true);
      setEditing(false);
      attempt.current = null;
      setUncertainSave(false);
      setConflict(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load the care record.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function save() {
    if (
      !contextMatches ||
      busyRef.current ||
      (!dirty && !attempt.current) ||
      historical ||
      conflict
    )
      return;
    let reviewedBody = body;
    if (sessionContext && !attempt.current) {
      const work = MindSessionWorkSchema.safeParse({ ...sessionContext, ...workDraft });
      if (!work.success) {
        setError(
          'Choose what happened and describe it in your own words. The client response can be left blank if it is not known.',
        );
        return;
      }
      reviewedBody = { ...body, sessionWork: work.data };
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setReceipt(null);
    try {
      attempt.current ??= {
        expectedVersion: record?.version ?? 0,
        body: reviewedBody,
        operationId: crypto.randomUUID(),
      };
      const payload = attempt.current;
      setUncertainSave(true);
      const response = await fetch(`/api/v1/clients/${clientId}/care-record`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(25_000),
      });
      const json: unknown = await response.json().catch(() => null);
      const parsed = MindCareRecordResponseSchema.safeParse(json);
      const receiptBody =
        parsed.success && parsed.data.record ? { ...parsed.data.record.body } : null;
      if (receiptBody && payload.body.sessionWork === undefined) delete receiptBody.sessionWork;
      if (
        !response.ok ||
        !parsed.success ||
        parsed.data.record?.operationId !== payload.operationId ||
        parsed.data.record?.version !== payload.expectedVersion + 1 ||
        parsed.data.record?.clientId !== clientId ||
        JSON.stringify(receiptBody) !== JSON.stringify(MindCareRecordBodySchema.parse(payload.body))
      ) {
        if (response.status === 409 || [401, 403, 404].includes(response.status)) {
          attempt.current = null;
          setUncertainSave(false);
          setConflict(true);
        } else if ([400, 422].includes(response.status)) {
          attempt.current = null;
          setUncertainSave(false);
        }
        throw new Error(
          response.status === 409
            ? 'A newer record or a conflicting save exists. Your draft is kept here. Copy any changes you need, then discard this draft and load the current version.'
            : [401, 403, 404].includes(response.status)
              ? 'Access to the care record could not be confirmed. Preserve your draft and check your access before reloading.'
              : [400, 422].includes(response.status)
                ? 'Some care-record fields need checking. Your wording is still here. Check dates and field lengths, then save again.'
                : 'The save could not be confirmed. Your draft is still here; retry the same save.',
        );
      }
      setRecord(parsed.data.record);
      setBody(parsed.data.record.body);
      setWorkDraft(workDraftFor(parsed.data.record.body.sessionWork, sessionContext?.sessionId));
      setLatestVersion(parsed.data.latestVersion);
      setEditing(false);
      setReceipt(
        `Version ${parsed.data.record.version} saved. ${sessionContext ? 'Confirmed work is available in preparation. The clinical note is unchanged. ' : ''}No consent, discharge or sharing status changed.`,
      );
      attempt.current = null;
      setUncertainSave(false);
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
  const readonly = !editing || busy || historical || uncertainSave || conflict;
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

  if (!contextMatches)
    return (
      <section
        role="status"
        className="mt-5 rounded-2xl border border-[var(--color-line-soft)] p-5 text-sm"
      >
        <p>The care-record context has changed. Content from the previous view is hidden.</p>
        {dirty || uncertainSave || busy ? (
          <p className="mt-2">
            The previous view still has work or a save to resolve. Its draft remains held in this
            open panel. Switch back to that client and visit before leaving or reloading.
          </p>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            className="mt-3"
            onClick={() => {
              setOpen(false);
              setLoaded(false);
              setRecord(null);
              setLatestVersion(0);
              setBody(EMPTY_MIND_CARE_RECORD);
              setEditing(false);
              setWorkDraft(emptyWork());
              setError(null);
              setReceipt(null);
              setVersionToRead('');
              setConflict(false);
              attempt.current = null;
              setBoundContext({
                clientId: requestedClientId,
                sessionContext: requestedSessionContext,
              });
            }}
          >
            Switch care-record view
          </Button>
        )}
      </section>
    );

  return (
    <section
      className={
        embedded
          ? ''
          : 'mt-5 rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-5'
      }
      aria-labelledby={`${id}-title`}
    >
      {embedded ? (
        <h4 id={`${id}-title`} className="text-sm font-semibold">
          Record this session’s work
        </h4>
      ) : (
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
          <span className="font-serif text-xl">
            {sessionContext ? 'Work done & client response' : 'Care agreement & reviews'}
          </span>
          <span className="text-sm text-[var(--color-accent)]">{open ? 'Close' : 'Open'}</span>
        </button>
      )}
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--color-ink-2)]">
        {sessionContext
          ? 'Record only what actually happened. Reading or selecting a guide does not record delivered work. Saving here does not change your clinical note or create homework.'
          : 'What you and the client discussed, how the work is helping, and what happens next. A living clinical record, separate from recording permissions.'}
      </p>
      {(embedded || open) && (
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
                    ? `${historical ? 'Historical' : 'Current'} care-record version ${record.version} of ${latestVersion} · saved ${new Date(record.createdAt).toLocaleDateString()}`
                    : 'No care agreement or review recorded yet.'}
                </p>
                {!editing && !historical && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      setEditing(true);
                      setWorkDraft(
                        workDraftFor(record?.body.sessionWork, sessionContext?.sessionId),
                      );
                      setReceipt(null);
                    }}
                  >
                    {sessionContext
                      ? 'Record or correct this visit’s work'
                      : record
                        ? 'Update care record'
                        : 'Record what was discussed'}
                  </Button>
                )}
                {historical && (
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => void load()}>
                    Return to current version
                  </Button>
                )}
              </div>
              {(sessionContext || body.sessionWork) && (
                <section className="space-y-4" aria-labelledby={`${id}-work`}>
                  <h3 id={`${id}-work`} className="text-base font-semibold">
                    Clinician-confirmed session work
                  </h3>
                  {sessionContext && editing ? (
                    <>
                      <p className="text-xs text-[var(--color-ink-3)]">
                        This visit was scheduled for{' '}
                        {formatMindWorkDate(sessionContext.scheduledAt)}. Confirm only your own
                        account of what happened. A response is not required when it is unknown.
                      </p>
                      <label className="block text-sm" htmlFor={`${id}-work-status`}>
                        What happened?
                        <select
                          id={`${id}-work-status`}
                          value={workDraft.disposition}
                          disabled={readonly}
                          onChange={(event) =>
                            setWorkDraft((previous) => ({
                              ...previous,
                              disposition: event.target.value as WorkDraft['disposition'],
                            }))
                          }
                          className="mt-2 block rounded-lg border border-[var(--color-line)] p-2"
                        >
                          <option value="">Choose what happened</option>
                          <option value="USED">Work carried out as planned</option>
                          <option value="ADAPTED">Work adapted during the visit</option>
                          <option value="PAUSED">Work started, then paused</option>
                          <option value="NOT_USED">Planned work was not used</option>
                        </select>
                      </label>
                      <label className="block text-sm" htmlFor={`${id}-work-done`}>
                        What actually happened, including changes or work not used
                        <textarea
                          id={`${id}-work-done`}
                          value={workDraft.workDone}
                          readOnly={readonly}
                          maxLength={2000}
                          rows={3}
                          onChange={(event) =>
                            setWorkDraft((previous) => ({
                              ...previous,
                              workDone: event.target.value,
                            }))
                          }
                          className="mt-2 block w-full rounded-xl border border-[var(--color-line)] p-3"
                        />
                      </label>
                      <label className="block text-sm" htmlFor={`${id}-work-response`}>
                        The client’s response, if known
                        <textarea
                          id={`${id}-work-response`}
                          value={workDraft.clientResponse}
                          readOnly={readonly}
                          maxLength={2000}
                          rows={3}
                          onChange={(event) =>
                            setWorkDraft((previous) => ({
                              ...previous,
                              clientResponse: event.target.value,
                            }))
                          }
                          className="mt-2 block w-full rounded-xl border border-[var(--color-line)] p-3"
                        />
                      </label>
                      <p className="text-xs text-[var(--color-ink-3)]">
                        Use Agreements or homework for agreed next steps. Nothing is added there
                        automatically.
                      </p>
                    </>
                  ) : body.sessionWork ? (
                    <>
                      <p className="text-xs text-[var(--color-ink-3)]">
                        Recorded work from the visit scheduled for{' '}
                        {formatMindWorkDate(body.sessionWork.scheduledAt)}.{' '}
                        {sessionContext && body.sessionWork.sessionId !== sessionContext.sessionId
                          ? 'This is another visit, not this session.'
                          : ''}
                      </p>
                      <p className="text-sm font-medium">
                        {MIND_WORK_LABELS[body.sessionWork.disposition]}
                      </p>
                      <p className="whitespace-pre-wrap text-sm leading-relaxed">
                        {body.sessionWork.workDone}
                      </p>
                      <p className="whitespace-pre-wrap text-sm leading-relaxed">
                        Client response:{' '}
                        {body.sessionWork.clientResponse ||
                          'Not recorded; no response or improvement is inferred.'}
                      </p>
                      <Link
                        href={`/app/sessions/${encodeURIComponent(body.sessionWork.sessionId)}`}
                        className="text-sm text-[var(--color-accent)] underline"
                      >
                        Open source visit
                      </Link>
                      {!sessionContext && (
                        <p className="text-xs text-[var(--color-ink-3)]">
                          Open the source visit to correct this work record. Earlier wording remains
                          in care-record history.
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-[var(--color-ink-3)]">
                      No actual work has been confirmed for this visit.
                    </p>
                  )}
                </section>
              )}
              {!sessionContext && (
                <>
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
                        transfers, refers or contacts the client. Use the separate clinical action
                        when appropriate.
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
                </>
              )}
              {editing && (
                <div className="flex flex-wrap gap-3 border-t border-[var(--color-line-soft)] pt-4">
                  <Button
                    size="sm"
                    disabled={busy || (!dirty && !attempt.current) || historical || conflict}
                    onClick={() => void save()}
                  >
                    {uncertainSave
                      ? 'Retry the same save'
                      : sessionContext
                        ? 'Confirm work & save'
                        : 'Save reviewed version'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy || uncertainSave}
                    onClick={() => {
                      setBody(record?.body ?? EMPTY_MIND_CARE_RECORD);
                      setWorkDraft(
                        workDraftFor(record?.body.sessionWork, sessionContext?.sessionId),
                      );
                      setEditing(false);
                      setError(null);
                      setConflict(false);
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
