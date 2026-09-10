'use client';

import { useId, useRef, useState } from 'react';
import type { SessionAgreementDto } from '@cureocity/contracts';
import { ExerciseAssignmentSchema } from '@cureocity/contracts';
import { Button } from '../ui/Button';
import { ShareModal } from './ShareModal';
import { useUnsavedWorkGuard } from '@/lib/use-unsaved-work-guard';

/** An explicit, reviewed conversion. Creating homework never sends it or changes the agreement. */
export function AgreementHomework({
  agreement,
  disabled = false,
}: {
  agreement: SessionAgreementDto;
  disabled?: boolean;
}) {
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [task, setTask] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [frequency, setFrequency] = useState('');
  const [sourceRevision, setSourceRevision] = useState(agreement.revision ?? 0);
  const [saved, setSaved] = useState<{
    id: string;
    sourceAgreementRevision: number;
    customDescription: string | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const requestRef = useRef<{ fingerprint: string; operationId: string } | null>(null);
  const busyRef = useRef(false);
  useUnsavedWorkGuard(open, 'This homework has not been saved. Leave without saving?', busy);
  const current =
    (saved?.sourceAgreementRevision === (agreement.revision ?? 0) ? saved : null) ??
    agreement.homeworkAssignments?.find(
      (a) => a.sourceAgreementRevision === (agreement.revision ?? 0),
    );
  const older = [...(agreement.homeworkAssignments ?? []), ...(saved ? [saved] : [])].filter(
    (a) => a.sourceAgreementRevision !== (agreement.revision ?? 0),
  );
  const changed = sourceRevision !== (agreement.revision ?? 0);

  async function create() {
    if (!agreement.clientId || busyRef.current || changed) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const payload = {
        clientId: agreement.clientId,
        sourceSessionId: agreement.sessionId,
        sourceAgreementId: agreement.id,
        sourceAgreementRevision: sourceRevision,
        task: task.trim(),
        deliveryChannel: 'PORTAL_LINK',
        ...(dueAt ? { dueAt: new Date(dueAt).toISOString() } : {}),
        ...(frequency.trim() ? { frequency: frequency.trim() } : {}),
      };
      const fingerprint = JSON.stringify(payload);
      if (requestRef.current?.fingerprint !== fingerprint)
        requestRef.current = { fingerprint, operationId: crypto.randomUUID() };
      const response = await fetch('/api/v1/assignments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...payload, idempotencyKey: requestRef.current.operationId }),
        signal: AbortSignal.timeout(15_000),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(
          response.status === 409
            ? 'This agreement or its homework changed. Reload saved agreements before creating another task. Existing homework has not been rewritten.'
            : 'Homework could not be confirmed. Keep these details and retry the same save.',
        );
      const result = ExerciseAssignmentSchema.safeParse(body);
      if (
        !result.success ||
        result.data.sourceAgreementId !== agreement.id ||
        result.data.sourceAgreementRevision !== sourceRevision ||
        result.data.customDescription !== payload.task
      )
        throw new Error(
          'Homework was not confirmed. Your details are still here; retry the same save.',
        );
      setSaved({
        id: result.data.id,
        sourceAgreementRevision: sourceRevision,
        customDescription: result.data.customDescription,
      });
      setOpen(false);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Homework could not be confirmed. Retry the same save.',
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  if (agreement.canUseAsHomework === false) return null;
  return (
    <div className="mt-3 space-y-2 text-sm">
      {older.length > 0 && (
        <p className="text-xs text-[var(--color-ink-2)]">
          Homework from earlier wording remains unchanged. Review it in the client’s homework before
          creating a replacement.
        </p>
      )}
      {current ? (
        <>
          <p className="text-xs text-[var(--color-ink-2)]">
            Linked homework · agreement revision {current.sourceAgreementRevision}. Saved does not
            mean sent or completed.
          </p>
          <p className="whitespace-pre-wrap">{current.customDescription}</p>
          <Button variant="ghost" size="sm" disabled={disabled} onClick={() => setSharing(true)}>
            Preview homework link
          </Button>
          {agreement.clientId && (
            <ShareModal
              open={sharing}
              onClose={() => setSharing(false)}
              clientId={agreement.clientId}
              hasContactPhone={false}
              hasContactEmail={false}
              artefact={{ artefactType: 'HOMEWORK', assignmentId: current.id }}
              artefactLabel="Agreed homework"
            />
          )}
        </>
      ) : (
        !agreement.retiredAt &&
        agreement.followUp !== 'DONE' &&
        agreement.clientId &&
        !open && (
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => {
              setOpen(true);
              setTask(agreement.text);
              setSourceRevision(agreement.revision ?? 0);
              setError(null);
            }}
          >
            Use as homework
          </Button>
        )
      )}
      {open && (
        <div className="space-y-3 rounded-xl border border-[var(--color-line)] p-3">
          <p className="font-medium">Review the task with the client</p>
          <p className="text-xs text-[var(--color-ink-2)]">
            This saves a separate task linked to this wording. It does not send a message. Later
            agreement corrections will not rewrite this homework.
          </p>
          {changed && (
            <p role="alert">
              The agreement wording changed. Keep or copy your draft, then cancel and reopen to
              review the latest wording.
            </p>
          )}
          <label className="block" htmlFor={`${fieldId}-task`}>
            What will the client try?
          </label>
          <textarea
            id={`${fieldId}-task`}
            value={task}
            maxLength={2000}
            disabled={busy}
            onChange={(e) => setTask(e.target.value)}
            className="w-full rounded-xl border border-[var(--color-line)] p-3"
            rows={3}
          />
          <label className="block" htmlFor={`${fieldId}-frequency`}>
            When or how often?
          </label>
          <input
            id={`${fieldId}-frequency`}
            value={frequency}
            maxLength={200}
            disabled={busy}
            onChange={(e) => setFrequency(e.target.value)}
            placeholder="For example, once before our next meeting"
            className="w-full rounded-xl border border-[var(--color-line)] p-3"
          />
          <label className="block" htmlFor={`${fieldId}-due`}>
            Review by (optional if timing is described)
          </label>
          <input
            id={`${fieldId}-due`}
            type="datetime-local"
            value={dueAt}
            disabled={busy}
            onChange={(e) => setDueAt(e.target.value)}
            className="rounded-xl border border-[var(--color-line)] p-3"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={
                disabled || busy || changed || !task.trim() || (!frequency.trim() && !dueAt)
              }
              onClick={() => void create()}
            >
              {busy ? 'Saving…' : 'Save homework — do not send'}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
              Cancel homework draft
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="text-[var(--color-warn)]">
          {error}
        </p>
      )}
    </div>
  );
}
