'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  MindManualNoteFieldsSchema,
  MIND_SESSION_PURPOSE_LABELS,
  type MindManualNoteFields,
  type MindSessionPurpose,
} from '@cureocity/contracts';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { FieldError, Label, Select } from '../ui/Field';
import { postSignNote } from '@/lib/sign-note';
import { useUnsavedWorkGuard } from '@/lib/use-unsaved-work-guard';
import { MindSessionAgreements } from './MindSessionAgreements';
import { ScheduleSessionPanel } from './ScheduleSessionPanel';

type State = {
  sessionId: string;
  kind: string;
  purpose: MindSessionPurpose | null;
  status: string;
  revision: number;
  noteUpdatedAt: string | null;
  fields: MindManualNoteFields;
  hasUnappliedDraft: boolean;
  note: unknown | null;
  signed: boolean;
  signedAt: string | null;
};
const INTAKE_FIELDS = [
  ['presentingConcerns', 'What brought the client here?'],
  ['historyOfPresentingIllness', 'How has this developed and affected everyday life?'],
  ['pastPsychiatricHistory', 'Relevant previous care and history'],
  ['familyHistory', 'Relevant family history'],
  ['socialHistory', 'Relationships, circumstances, strengths and support'],
  ['mentalStatusExam', 'Your observations and mental status assessment'],
  ['workingHypothesis', 'Shared understanding / what remains uncertain'],
  ['immediatePlan', 'What was done and what was agreed next?'],
] as const;
const THERAPY_FIELDS = [
  ['subjective', 'What the client shared and today’s focus'],
  ['objective', 'Your observations and work actually done'],
  ['assessment', 'Your understanding, response to the session and uncertainty'],
  ['plan', 'What you agreed together / next steps'],
] as const;

/** A fully clinician-written journey: no microphone, transcription, prompt or generated evidence. */
export function MindManualSession({
  sessionId,
  clientId,
  clientName,
  canShare,
  followUpSession,
}: {
  sessionId: string;
  clientId: string;
  clientName: string;
  canShare: boolean;
  followUpSession?: { id: string; scheduledAt: string } | null;
}) {
  const [loaded, setLoaded] = useState<State | null>(null);
  const [fields, setFields] = useState<MindManualNoteFields>(() =>
    MindManualNoteFieldsSchema.parse({}),
  );
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [needsReload, setNeedsReload] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const pendingWrite = useRef<{
    operation: 'save' | 'complete';
    expectedRevision: number;
    expectedNoteUpdatedAt: string | null;
    mutationId: string;
    fields: MindManualNoteFields;
  } | null>(null);
  const mounted = useRef(true);
  const apply = useCallback((next: State) => {
    setLoaded(next);
    setFields(next.fields);
    setDirty(false);
    setEditing(!next.note || next.hasUnappliedDraft);
    setNeedsReload(false);
  }, []);
  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/sessions/${sessionId}/manual-note`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(15_000),
      });
      const body = (await response.json()) as State & { error?: string };
      if (!response.ok) throw new Error(body.error ?? 'Could not load the saved note.');
      if (mounted.current) {
        apply(body);
        pendingWrite.current = null;
        return body;
      }
    } catch (cause) {
      if (mounted.current) setError((cause as Error).message);
    } finally {
      if (mounted.current) setBusy(false);
    }
    return null;
  }, [sessionId, apply]);
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);
  useUnsavedWorkGuard(
    dirty || !!pendingWrite.current,
    'Some note changes may not be saved. Copy your text or save before leaving this view.',
    busy,
  );

  async function write(operation: 'save' | 'complete') {
    if (!loaded || busy || needsReload) return;
    const body = pendingWrite.current ?? {
      operation,
      expectedRevision: loaded.revision,
      expectedNoteUpdatedAt: loaded.noteUpdatedAt,
      mutationId: crypto.randomUUID(),
      fields: structuredClone(fields),
    };
    pendingWrite.current = body;
    setBusy(true);
    setError(null);
    setMessage('');
    try {
      const response = await fetch(`/api/v1/sessions/${sessionId}/manual-note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
      const result = (await response.json()) as State & { error?: string };
      if (!response.ok) {
        // A validation/conflict refusal is definitive. A proxy/server 5xx may
        // arrive after commit, so retain its exact receipt for an idempotent retry.
        if (response.status < 500) pendingWrite.current = null;
        throw new Error(result.error ?? 'Could not save your note.');
      }
      if (mounted.current) {
        pendingWrite.current = null;
        apply(result);
        setMessage(
          body.operation === 'save'
            ? 'Draft saved securely. It is not signed.'
            : 'Session finished. Review your note, then sign when ready.',
        );
      }
    } catch (cause) {
      if (mounted.current) setError((cause as Error).message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function sign() {
    if (!loaded?.note || dirty || loaded.hasUnappliedDraft || busy || needsReload) return;
    setBusy(true);
    setError(null);
    setMessage('');
    // A lost response can follow a committed signature. Do not expose the
    // obsolete draft again until an authoritative read establishes its state.
    setNeedsReload(true);
    try {
      const response = await postSignNote(
        sessionId,
        {
          note: loaded.note,
          draftContent: loaded.note,
          edits: [],
          signedAt: new Date().toISOString(),
          rxPad: null,
        },
        { requestTimeoutMs: 20_000 },
      );
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Could not sign the note.');
      const refreshed = await load();
      if (mounted.current && refreshed?.signed)
        setMessage('Your clinical note is signed. Nothing has been shared.');
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function reopen() {
    if (!loaded?.signed || busy || needsReload) return;
    setBusy(true);
    setError(null);
    setMessage('');
    setNeedsReload(true);
    try {
      const response = await fetch(`/api/v1/sessions/${sessionId}/note/unlock`, {
        method: 'POST',
        signal: AbortSignal.timeout(20_000),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Could not reopen the signed note.');
      const refreshed = await load();
      if (mounted.current && refreshed && !refreshed.signed) setEditing(true);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const activeFields = loaded?.kind === 'INTAKE' ? INTAKE_FIELDS : THERAPY_FIELDS;
  const readOnly = loaded?.signed || !editing || needsReload;
  return (
    <div className="mx-auto max-w-4xl space-y-6 py-8">
      <Link href={`/app/clients/${clientId}`} className="text-sm text-[var(--color-ink-3)]">
        ← Back to {clientName}
      </Link>
      <Card className="p-7">
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-accent)]">
          Clinician-written session
        </p>
        <h1 className="mt-2 font-serif text-3xl">A little space to listen.</h1>
        <p className="mt-3 text-[var(--color-ink-2)]">
          {clientName} ·{' '}
          {loaded?.purpose ? MIND_SESSION_PURPOSE_LABELS[loaded.purpose] : 'Session note'}
        </p>
        <p className="mt-2 text-sm text-[var(--color-ink-3)]">
          No recording or AI processing in this session. This note contains only your own clinical
          documentation.
        </p>
      </Card>
      <FieldError message={error} />
      {!loaded && (
        <Button onClick={load} disabled={busy}>
          {busy ? 'Loading your note…' : 'Try loading again'}
        </Button>
      )}
      {loaded && (
        <Card className="space-y-5 p-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-serif text-2xl">
              {loaded.signed
                ? 'Signed clinical note'
                : editing
                  ? 'Your working note'
                  : 'Review your clinical note'}
            </h2>
            <span className="text-sm text-[var(--color-ink-3)]" role="status">
              {busy
                ? 'Working…'
                : needsReload
                  ? 'Reload to check the saved note status'
                  : dirty
                    ? 'Unsaved changes'
                    : loaded.signed
                      ? 'Signed and locked'
                      : loaded.hasUnappliedDraft
                        ? 'Draft saved · not signed'
                        : 'Not signed'}
            </span>
          </div>
          {editing && (
            <p className="text-sm text-[var(--color-ink-3)]">
              Write what you actually explored, observed or agreed. Save an incomplete draft at any
              point. Before review, document required areas in your own words—including what remains
              unknown.
            </p>
          )}
          {activeFields.map(([key, label]) => (
            <div key={key}>
              <Label htmlFor={`manual-${key}`}>{label}</Label>
              {readOnly ? (
                <p className="whitespace-pre-wrap text-sm leading-7">
                  {fields[key] || 'Not documented'}
                </p>
              ) : (
                <textarea
                  id={`manual-${key}`}
                  value={fields[key]}
                  maxLength={6000}
                  rows={key === 'pastPsychiatricHistory' || key === 'familyHistory' ? 2 : 4}
                  disabled={busy || !!pendingWrite.current}
                  onChange={(event) => {
                    setFields((prior) => ({ ...prior, [key]: event.target.value }));
                    setDirty(true);
                    setMessage('');
                  }}
                  className="w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-bg)] p-3 text-sm leading-7 focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
                />
              )}
            </div>
          ))}
          <div className="rounded-2xl border border-[var(--color-line)] p-4">
            <Label htmlFor="manual-risk">Your current safety assessment</Label>
            {readOnly ? (
              <p className="text-sm">{fields.riskSeverity ?? 'Not yet documented'}</p>
            ) : (
              <Select
                id="manual-risk"
                disabled={busy || !!pendingWrite.current}
                value={fields.riskSeverity ?? ''}
                onChange={(event) => {
                  setFields((prior) => ({
                    ...prior,
                    riskSeverity: event.target.value
                      ? (event.target.value as MindManualNoteFields['riskSeverity'])
                      : null,
                  }));
                  setDirty(true);
                }}
              >
                <option value="">Not yet documented</option>
                <option value="none">No risk identified in this assessment</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </Select>
            )}
            <Label htmlFor="manual-risk-details">
              What you assessed, uncertainty and safety actions
            </Label>
            {readOnly ? (
              <p className="whitespace-pre-wrap text-sm leading-7">{fields.riskDetails}</p>
            ) : (
              <textarea
                id="manual-risk-details"
                value={fields.riskDetails}
                maxLength={6000}
                rows={3}
                disabled={busy || !!pendingWrite.current}
                onChange={(event) => {
                  setFields((prior) => ({ ...prior, riskDetails: event.target.value }));
                  setDirty(true);
                }}
                className="w-full rounded-xl border border-[var(--color-line)] p-3 text-sm leading-7"
              />
            )}
          </div>
          <p role="status" className="text-sm text-[var(--color-ink-2)]">
            {message}
          </p>
          <div className="flex flex-wrap gap-3">
            {needsReload ? (
              <p className="text-sm text-[var(--color-ink-2)]">
                The saved note status needs checking. Reload before editing, signing or downloading.
              </p>
            ) : loaded.signed ? (
              <>
                <Button variant="secondary" onClick={reopen} disabled={busy}>
                  Reopen to make a correction
                </Button>
                <Link
                  href={`/api/v1/sessions/${sessionId}/note/pdf`}
                  target="_blank"
                  className="px-3 py-2 text-sm underline"
                >
                  Download signed PDF
                </Link>
              </>
            ) : editing ? (
              <>
                <Button variant="secondary" onClick={() => write('save')} disabled={busy}>
                  {pendingWrite.current ? 'Retry the pending save' : 'Save draft'}
                </Button>
                {!pendingWrite.current && (
                  <Button onClick={() => write('complete')} disabled={busy}>
                    Finish session & review note
                  </Button>
                )}
              </>
            ) : (
              <>
                <Button variant="secondary" onClick={() => setEditing(true)} disabled={busy}>
                  Edit note
                </Button>
                <Button onClick={sign} disabled={busy || dirty || loaded.hasUnappliedDraft}>
                  Sign this note
                </Button>
              </>
            )}
            {(error || needsReload) && loaded && !pendingWrite.current && (
              <Button
                variant="secondary"
                onClick={() => {
                  if (
                    !dirty ||
                    window.confirm(
                      'Replace this view with the saved version? Copy any unsaved text first.',
                    )
                  )
                    void load();
                }}
                disabled={busy}
              >
                Reload saved version
              </Button>
            )}
          </div>
          <p className="text-xs text-[var(--color-ink-3)]">
            Saving a draft does not sign it. Signing does not send anything to the client.
            {canShare ? ' Review the signed PDF before choosing whether to share it.' : ''}
          </p>
        </Card>
      )}
      {loaded?.status === 'COMPLETED' && !needsReload && (
        <Card className="space-y-5 p-7">
          <h2 className="font-serif text-2xl">What happens next?</h2>
          <p className="text-sm text-[var(--color-ink-3)]">
            Capture only what you and the client agreed. These follow-through actions do not alter
            the signed clinical note.
          </p>
          <MindSessionAgreements
            sessionId={sessionId}
            signed={loaded.signed}
            hasSignedNote={loaded.signedAt !== null}
          />
          <ScheduleSessionPanel
            clients={[{ id: clientId, fullName: clientName, preferredModality: null }]}
            initialClientId={clientId}
            sourceSessionId={sessionId}
            closeoutMode
            followUpState={followUpSession ? 'COMPLETE' : 'PENDING'}
            followUpSession={followUpSession ?? null}
          />
          <Link
            href={`/app/clients/${clientId}/plan`}
            className="inline-block text-sm text-[var(--color-accent)] underline"
          >
            Return to the living care plan
          </Link>
        </Card>
      )}
    </div>
  );
}
