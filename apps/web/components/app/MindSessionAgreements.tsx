'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AgreementSpeaker, SessionAgreementDto } from '@cureocity/contracts';
import { Button } from '../ui/Button';
import { AgreementHomework } from './AgreementHomework';
import { RetireAgreement } from './RetireAgreement';
import { useUnsavedWorkGuard } from '../../lib/use-unsaved-work-guard';
import {
  agreementSaveFingerprint,
  confirmedAgreementReceipt,
} from '../../lib/agreement-save-receipt';

type Reason = 'CORRECTION' | 'ATTRIBUTION' | 'CLARIFICATION';

/** One agreement editor. Signed-note content is never edited here; separate
 * amendments preserve prior wording and attribution on the care record. */
export function MindSessionAgreements({
  sessionId,
  signed,
  hasSignedNote = signed,
}: {
  sessionId: string;
  signed: boolean;
  hasSignedNote?: boolean;
}) {
  const router = useRouter();
  const [agreements, setAgreements] = useState<SessionAgreementDto[]>([]);
  const [text, setText] = useState('');
  const [speaker, setSpeaker] = useState<AgreementSpeaker>('THERAPIST');
  const [reason, setReason] = useState<Reason>('CORRECTION');
  const [editing, setEditing] = useState<SessionAgreementDto | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const attempt = useRef<{ fingerprint: string; operationId: string } | null>(null);
  const dirty = editing
    ? text.trim() !== editing.text || speaker !== editing.speaker
    : !!text.trim();
  useUnsavedWorkGuard(
    dirty,
    'This agreement has unsaved changes. Leave without saving them?',
    busy,
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoaded(false);
    void fetch(`/api/v1/sessions/${sessionId}/agreements`, {
      cache: 'no-store',
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not load agreements.');
        return response.json() as Promise<{ agreements: SessionAgreementDto[] }>;
      })
      .then((body) => {
        if (!controller.signal.aborted) {
          setAgreements(body.agreements);
          setLoaded(true);
          setError(null);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError('Could not load agreements. Retry before making changes.');
      });
    return () => controller.abort();
  }, [sessionId, retry]);

  function resetEditor() {
    setEditing(null);
    setText('');
    setSpeaker('THERAPIST');
    setReason('CORRECTION');
    attempt.current = null;
  }

  async function save() {
    if (busy || !loaded || !text.trim() || (editing && !dirty)) return;
    setBusy(true);
    setError(null);
    setReceipt(null);
    const operation: 'amend' | 'correct' = hasSignedNote ? 'amend' : 'correct';
    const intent: Parameters<typeof agreementSaveFingerprint>[0] = {
      sessionId,
      text: text.trim(),
      speaker,
      ...(editing
        ? {
            correction: {
              agreementId: editing.id,
              expectedRevision: editing.revision ?? 0,
              reason,
              operation,
            },
          }
        : {}),
    };
    const fingerprint = agreementSaveFingerprint(intent);
    if (attempt.current?.fingerprint !== fingerprint)
      attempt.current = { fingerprint, operationId: crypto.randomUUID() };
    try {
      const response = await fetch(
        `/api/v1/sessions/${sessionId}/agreements${editing ? `/${editing.id}` : ''}`,
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(
            editing
              ? {
                  operation,
                  operationId: attempt.current!.operationId,
                  expectedRevision: editing.revision ?? 0,
                  text: text.trim(),
                  speaker,
                  reason,
                }
              : { text: text.trim(), speaker, operationId: attempt.current!.operationId },
          ),
          signal: AbortSignal.timeout(15_000),
        },
      );
      const body = (await response.json()) as {
        agreement?: unknown;
        operationId?: string;
        error?: string;
      };
      const saved = confirmedAgreementReceipt(body, {
        ...intent,
        operationId: attempt.current!.operationId,
      });
      if (!response.ok || !saved)
        throw new Error(
          body.error ??
            'The save receipt could not be verified. Your wording is still here. Retry the same save.',
        );
      setAgreements((previous) =>
        previous.some((item) => item.id === saved.id)
          ? previous.map((item) => (item.id === saved.id ? saved : item))
          : [...previous, saved],
      );
      setReceipt(
        editing
          ? hasSignedNote
            ? 'Separate amendment saved. Earlier wording is in the correction history; the signed note is unchanged.'
            : 'Correction saved. Earlier wording is in the correction history.'
          : 'Agreement saved. Nothing has been sent to the client.',
      );
      resetEditor();
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error && !['TimeoutError', 'AbortError', 'TypeError'].includes(cause.name)
          ? cause.message
          : 'The save could not be confirmed. Your wording is still here. Retry the same save; it will not create a second correction.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(agreement: SessionAgreementDto) {
    if (busy || hasSignedNote) return;
    setBusy(true);
    setError(null);
    setReceipt(null);
    try {
      const response = await fetch(`/api/v1/sessions/${sessionId}/agreements/${agreement.id}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedRevision: agreement.revision ?? 0 }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(
          body.error ?? 'The removal could not be confirmed. Reload agreements before retrying.',
        );
      }
      setAgreements((previous) => previous.filter((item) => item.id !== agreement.id));
      setRemoving(null);
      if (editing?.id === agreement.id) resetEditor();
      setReceipt('Agreement removed. The removal is recorded in the audit trail.');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The removal could not be confirmed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      id="session-agreements"
      className="space-y-4"
      aria-labelledby="session-agreements-title"
    >
      <h3 id="session-agreements-title" className="text-sm font-semibold">
        What you agreed / homework
      </h3>
      <p className="text-sm text-[var(--color-ink-2)]">
        {hasSignedNote
          ? 'Care decisions are separate from the signed note. An amendment keeps earlier wording in the history; it does not change the signed note or send anything.'
          : 'Capture only the practical steps you agreed. You can correct the wording or attribution before signing.'}
      </p>
      <ul className="space-y-3 text-sm">
        {agreements.map((agreement) => (
          <li key={agreement.id} className="rounded-xl bg-[var(--color-surface-soft)] p-4">
            <p className="whitespace-pre-wrap">{agreement.text}</p>
            <p className="mt-1 text-xs text-[var(--color-ink-2)]">
              {agreement.speaker === 'CLIENT' ? 'Client’s words' : 'Psychologist’s wording'}
              {(agreement.revision ?? 0) > 0 ? ` · revision ${agreement.revision}` : ''}
              {agreement.followUp ? ' · follow-up recorded' : ''}
              {agreement.retiredAt ? ' · retired from active commitments' : ''}
            </p>
            {agreement.retirementReason && (
              <p className="mt-1 text-xs">Retirement reason: {agreement.retirementReason}</p>
            )}
            <AgreementHomework agreement={agreement} disabled={busy || dirty || !loaded} />
            <RetireAgreement
              agreement={agreement}
              disabled={busy || dirty || !loaded}
              onSaved={(saved) =>
                setAgreements((rows) => rows.map((row) => (row.id === saved.id ? saved : row)))
              }
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={busy || dirty || !loaded}
                onClick={() => {
                  setEditing(agreement);
                  setText(agreement.text);
                  setSpeaker(agreement.speaker);
                  setReason('CORRECTION');
                  setError(null);
                  setReceipt(null);
                  setRemoving(null);
                  attempt.current = null;
                }}
              >
                {hasSignedNote ? 'Amend care decision' : 'Correct agreement'}
              </Button>
              {!hasSignedNote &&
                agreement.followUp === null &&
                !agreement.retiredAt &&
                !agreement.homeworkAssignments?.length && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy || dirty || !loaded}
                    onClick={() => setRemoving(agreement.id)}
                  >
                    Remove
                  </Button>
                )}
            </div>
            {removing === agreement.id && (
              <div className="mt-3 space-y-2 border-t border-[var(--color-line)] pt-3">
                <p>Remove this entry recorded in error? This does not send a message.</p>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void remove(agreement)}
                >
                  Confirm removal
                </Button>{' '}
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => setRemoving(null)}>
                  Keep agreement
                </Button>
              </div>
            )}
            {!!agreement.revisions?.length && (
              <details className="mt-3 text-xs">
                <summary className="cursor-pointer">
                  Correction history ({agreement.revisions.length})
                </summary>
                <ol className="mt-2 space-y-3">
                  {agreement.revisions.map((entry) => (
                    <li
                      key={entry.operationId}
                      className="border-t border-[var(--color-line)] pt-2"
                    >
                      <p>
                        Revision {entry.revision} ·{' '}
                        {entry.operation === 'amend' ? 'Separate amendment' : 'Correction'} ·{' '}
                        {new Date(entry.recordedAt).toLocaleString()}
                      </p>
                      <p className="mt-1">
                        Before ({entry.previousSpeaker === 'CLIENT' ? 'client' : 'psychologist'}):{' '}
                        {entry.previousText}
                      </p>
                      <p>
                        After ({entry.speaker === 'CLIENT' ? 'client' : 'psychologist'}):{' '}
                        {entry.text}
                      </p>
                      <p>Reason: {entry.reason.toLowerCase()}.</p>
                      {entry.previousFollowUp && (
                        <p>
                          Follow-up on earlier wording:{' '}
                          {entry.previousFollowUp.toLowerCase().replace('_', ' ')}
                          {entry.previousFollowUpAt
                            ? ` · ${new Date(entry.previousFollowUpAt).toLocaleString()}`
                            : ''}
                          . Reassess follow-up for the corrected agreement.
                        </p>
                      )}
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </li>
        ))}
      </ul>
      {loaded ? (
        <div className="space-y-3">
          <label htmlFor="closeout-agreement" className="block text-sm font-medium">
            {editing
              ? hasSignedNote
                ? 'Separate amendment'
                : 'Correct the agreement'
              : 'Add an agreed next step'}
          </label>
          <textarea
            id="closeout-agreement"
            rows={3}
            maxLength={500}
            value={text}
            disabled={busy}
            onChange={(event) => setText(event.target.value)}
            className="w-full rounded-xl border border-[var(--color-line)] p-3 text-sm"
          />
          <fieldset disabled={busy} className="flex flex-wrap gap-4 text-sm">
            <legend className="mb-2 text-xs text-[var(--color-ink-2)]">
              Whose wording is this?
            </legend>
            {(['THERAPIST', 'CLIENT'] as const).map((value) => (
              <label key={value} className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="agreement-speaker"
                  value={value}
                  checked={speaker === value}
                  onChange={() => setSpeaker(value)}
                />
                {value === 'CLIENT' ? 'Client’s words' : 'Psychologist’s wording'}
              </label>
            ))}
          </fieldset>
          {editing && (
            <p className="text-sm text-[var(--color-ink-2)]">
              Saving keeps earlier wording, retirement and follow-up in history. The corrected
              agreement starts without a follow-up mark; review its status again when appropriate.
            </p>
          )}
          {editing && (
            <label className="block text-sm">
              Reason for correction
              <select
                value={reason}
                disabled={busy}
                onChange={(event) => setReason(event.target.value as Reason)}
                className="ml-3 rounded-lg border border-[var(--color-line)] p-2"
              >
                <option value="CORRECTION">Correct an error</option>
                <option value="ATTRIBUTION">Correct attribution</option>
                <option value="CLARIFICATION">Clarify wording</option>
              </select>
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={busy || !text.trim() || (editing ? !dirty : agreements.length >= 8)}
              onClick={() => void save()}
            >
              {busy
                ? 'Saving…'
                : editing
                  ? hasSignedNote
                    ? 'Save separate amendment'
                    : 'Save correction'
                  : hasSignedNote
                    ? 'Add care decision'
                    : 'Save agreement'}
            </Button>
            {(editing || text) && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={resetEditor}>
                Discard unsaved changes
              </Button>
            )}
          </div>
          <p role="status" className="text-xs text-[var(--color-ink-2)]">
            {dirty
              ? 'Unsaved changes. Save or discard them before leaving.'
              : (receipt ?? 'No unsaved changes.')}
            {!editing && agreements.length >= 8
              ? ' This session has eight agreements; you can still correct an existing one.'
              : ''}
          </p>
        </div>
      ) : (
        <p role="status" className="text-sm">
          Loading agreements…
        </p>
      )}
      {error && (
        <div role="alert" className="space-y-2 text-sm text-[var(--color-warn)]">
          <p>{error}</p>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => setRetry((value) => value + 1)}
          >
            Reload saved agreements
          </Button>
          {editing && (
            <p>
              Your unsaved wording is kept. Compare it with the reloaded record; discard and reopen
              the correction to use its latest revision.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
