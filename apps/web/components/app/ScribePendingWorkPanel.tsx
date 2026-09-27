'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import type {
  ScribePendingWork,
  ScribeTaskBody,
  ScribeTaskRecord,
} from '@/lib/scribe-preparation-contracts';
import {
  readScribeRequestError,
  safeScribeRequestError,
  type ScribeRequestError,
  type ScribeRequestOperation,
} from '@/lib/scribe-request-error';
import { Button } from '../ui/Button';
import { Input, Label, Select, Textarea } from '../ui/Field';
import { useScribeFetch } from './ScribeTransport';

export function ScribePendingWorkPanel({
  clientId,
  patients = [],
}: {
  clientId?: string;
  patients?: { id: string; name: string }[];
}) {
  const request = useScribeFetch();
  const [loaded, setLoaded] = useState<{
    clientId: string | undefined;
    data: ScribePendingWork;
  } | null>(null);
  const [error, setError] = useState<ScribeRequestError | null>(null);
  const accessDenied = useRef(false);
  const blocked = error?.blocksAccess ?? false;
  const data = !blocked && loaded?.clientId === clientId ? (loaded?.data ?? null) : null;
  const [busy, setBusy] = useState(false);
  const [closed, setClosed] = useState(false);
  const [patient, setPatient] = useState(clientId ?? '');
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [category, setCategory] = useState<ScribeTaskBody['category']>('results');
  const [dueDate, setDueDate] = useState('');
  const [assignee, setAssignee] = useState('Doctor (you)');
  const reportFailure = useCallback((reason: unknown, operation: ScribeRequestOperation) => {
    const failure = safeScribeRequestError(reason, operation);
    if (failure.blocksAccess) {
      accessDenied.current = true;
      setLoaded(null);
      setPatient('');
      setTitle('');
      setDetails('');
      setDueDate('');
      setAssignee('Doctor (you)');
    }
    // A late network error must not replace an already established access denial.
    if (failure.blocksAccess || !accessDenied.current) setError(failure);
    return failure;
  }, []);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (accessDenied.current) return;
      const response = await request(
        `/api/v1/scribe-tasks${clientId ? `?clientId=${encodeURIComponent(clientId)}` : ''}`,
        { signal, cache: 'no-store' },
      );
      if (!response.ok) throw await readScribeRequestError(response, 'load');
      const body = (await response.json()) as ScribePendingWork;
      // An older successful refresh must never restore data after another request loses access.
      if (!signal?.aborted && !accessDenied.current) setLoaded({ clientId, data: body });
    },
    [clientId, request],
  );
  useEffect(() => {
    const controller = new AbortController();
    accessDenied.current = false;
    setLoaded(null);
    setError(null);
    setPatient(clientId ?? '');
    void load(controller.signal).catch((reason: unknown) => {
      if (!controller.signal.aborted) reportFailure(reason, 'load');
    });
    return () => controller.abort();
  }, [load, reportFailure]);
  async function create(event: FormEvent) {
    event.preventDefault();
    if (accessDenied.current) return;
    setBusy(true);
    setError(null);
    try {
      const response = await request('/api/v1/scribe-tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clientId: patient,
          task: { title, details, category, dueDate, assignee },
        }),
      });
      if (!response.ok) throw await readScribeRequestError(response, 'create');
      setTitle('');
      setDetails('');
      await load();
    } catch (reason) {
      reportFailure(reason, 'create');
    } finally {
      setBusy(false);
    }
  }
  async function change(record: ScribeTaskRecord, changes: Partial<ScribeTaskBody>) {
    if (accessDenied.current) return;
    setBusy(true);
    setError(null);
    try {
      const response = await request(`/api/v1/scribe-tasks/${record.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          expectedRevision: record.revision,
          task: { ...record.body, ...changes },
        }),
      });
      if (!response.ok) throw await readScribeRequestError(response, 'update');
      await load();
    } catch (reason) {
      const failure = reportFailure(reason, 'update');
      if (failure.kind === 'conflict' && !accessDenied.current) {
        await load().catch((loadReason: unknown) => reportFailure(loadReason, 'load'));
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="my-8 rounded-2xl border border-[var(--color-line)] bg-white p-5"
      aria-label="Pending work inbox"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-serif text-xl">Pending work</h2>
        {!blocked && (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setError(null);
              void load().catch((reason: unknown) => reportFailure(reason, 'load'));
            }}
          >
            Refresh
          </Button>
        )}
      </div>
      <p className="mt-1 text-sm text-[var(--color-ink-3)]">
        Unsigned notes and doctor-created work items. Assignee is a label only; no staff access,
        reminders or messages are sent.
      </p>
      {error && (
        <div role="alert" className="mt-3 text-sm text-[var(--color-warn)]">
          <p>{error.message}</p>
          {error.action && (
            <Link className="mt-2 inline-block underline" href={error.action.href}>
              {error.action.label}
            </Link>
          )}
        </div>
      )}
      {!data ? (
        <p role="status" className="mt-3">
          {error ? 'Inbox unavailable.' : 'Loading…'}
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          <div>
            <h3 className="font-medium">
              Unsigned notes ({data.unsigned.length}
              {data.unsignedMayHaveMore ? '+' : ''})
            </h3>
            {data.unsigned.length === 0 ? (
              <p className="text-sm text-[var(--color-ink-3)]">
                No completed unsigned notes found.
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {data.unsigned.map((note) => (
                  <li key={note.sessionId}>
                    <Link
                      className="text-sm text-[var(--color-accent)] underline"
                      href={`/app/patients/${note.clientId}/encounters/${note.sessionId}`}
                    >
                      {note.patientName || 'Patient'} ·{' '}
                      {new Date(note.encounterAt).toLocaleDateString('en-IN')} · Review note
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {data.unsignedMayHaveMore && (
              <p className="text-xs">
                Showing the oldest 100; further items appear as these are completed.
              </p>
            )}
          </div>
          <div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={closed}
                onChange={(event) => setClosed(event.target.checked)}
              />
              Include completed/cancelled tasks
            </label>
            {data.tasksMayHaveMore && (
              <p role="status" className="mt-2 text-sm text-[var(--color-warn)]">
                Showing the 500 most recently updated tasks. Older tasks may be omitted; open the
                patient record to narrow the inbox.
              </p>
            )}
            <ul className="mt-3 space-y-3">
              {data.tasks
                .filter((task) => closed || task.body.status === 'open')
                .map((record) => (
                  <li
                    key={record.id}
                    className="rounded-xl border border-[var(--color-line-soft)] p-3"
                  >
                    <p className="font-medium">{record.body.title}</p>
                    <p className="text-xs text-[var(--color-ink-3)]">
                      {record.body.category.replace('_', ' ')} · Due {record.body.dueDate} ·{' '}
                      {record.body.assignee} · {record.body.status}
                    </p>
                    {record.body.details && (
                      <p className="mt-1 whitespace-pre-wrap text-sm">{record.body.details}</p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {record.clientId && (
                        <Link
                          className="text-sm text-[var(--color-accent)] underline"
                          href={`/app/patients/${record.clientId}`}
                        >
                          Patient record
                        </Link>
                      )}
                      {record.body.status === 'open' ? (
                        <>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busy}
                            onClick={() => void change(record, { status: 'done' })}
                          >
                            Mark done
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busy}
                            onClick={() => void change(record, { status: 'cancelled' })}
                          >
                            Cancel task
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy}
                          onClick={() => void change(record, { status: 'open' })}
                        >
                          Reopen
                        </Button>
                      )}
                    </div>
                    <TaskEditor
                      key={`${record.id}:${record.revision}`}
                      record={record}
                      busy={busy}
                      onSave={change}
                    />
                  </li>
                ))}
            </ul>
            {!data.tasks.some((task) => closed || task.body.status === 'open') && (
              <p className="mt-2 text-sm text-[var(--color-ink-3)]">
                No {closed ? '' : 'open '}tasks.
              </p>
            )}
          </div>
        </div>
      )}
      {data && (
        <details className="mt-5 border-t border-[var(--color-line-soft)] pt-3">
          <summary className="cursor-pointer font-medium">
            Add pending result, referral or follow-up
          </summary>
          <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={(event) => void create(event)}>
            {!clientId && (
              <label className="text-sm">
                Patient
                <Select
                  value={patient}
                  onChange={(event) => setPatient(event.target.value)}
                  required
                >
                  <option value="">Select patient</option>
                  {patients.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </Select>
              </label>
            )}
            <label className="text-sm">
              Type
              <Select
                value={category}
                onChange={(event) => setCategory(event.target.value as ScribeTaskBody['category'])}
              >
                <option value="results">Result review</option>
                <option value="referral">Referral</option>
                <option value="follow_up">Follow-up</option>
              </Select>
            </label>
            <label className="text-sm">
              Task
              <Input
                value={title}
                maxLength={300}
                onChange={(event) => setTitle(event.target.value)}
                required
              />
            </label>
            <label className="text-sm">
              Due date
              <Input
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
                required
              />
            </label>
            <label className="text-sm">
              Responsible person (label only)
              <Input
                value={assignee}
                maxLength={100}
                onChange={(event) => setAssignee(event.target.value)}
                required
              />
            </label>
            <div className="sm:col-span-2">
              <Label htmlFor={`task-details-${clientId ?? 'clinic'}`}>Details</Label>
              <Textarea
                id={`task-details-${clientId ?? 'clinic'}`}
                value={details}
                maxLength={2000}
                onChange={(event) => setDetails(event.target.value)}
              />
            </div>
            <Button type="submit" disabled={busy || !patient}>
              {busy ? 'Saving…' : 'Create task'}
            </Button>
          </form>
        </details>
      )}
    </section>
  );
}

function TaskEditor({
  record,
  busy,
  onSave,
}: {
  record: ScribeTaskRecord;
  busy: boolean;
  onSave: (record: ScribeTaskRecord, changes: Partial<ScribeTaskBody>) => Promise<void>;
}) {
  const [dueDate, setDueDate] = useState(record.body.dueDate);
  const [assignee, setAssignee] = useState(record.body.assignee);
  const [completionNote, setCompletionNote] = useState(record.body.completionNote);
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer">Edit due date, responsibility or outcome</summary>
      <form
        className="mt-2 grid gap-2 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          void onSave(record, { dueDate, assignee, completionNote });
        }}
      >
        <label>
          Due date
          <Input
            type="date"
            required
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
          />
        </label>
        <label>
          Responsible person (label only)
          <Input
            required
            maxLength={100}
            value={assignee}
            onChange={(event) => setAssignee(event.target.value)}
          />
        </label>
        <label className="sm:col-span-2">
          Outcome / work note
          <Textarea
            maxLength={1000}
            value={completionNote}
            onChange={(event) => setCompletionNote(event.target.value)}
          />
        </label>
        <Button type="submit" variant="secondary" size="sm" disabled={busy}>
          Save task changes
        </Button>
      </form>
    </details>
  );
}
