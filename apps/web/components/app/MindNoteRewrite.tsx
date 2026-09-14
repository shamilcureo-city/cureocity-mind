'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { IntakeNoteV1Schema, TherapyNoteV1Schema } from '@cureocity/contracts';
import { Button } from '../ui/Button';
import {
  narrativeChanges,
  readMindNoteProposal,
  type EditableMindNote,
  type MindNoteProposal,
} from '@/lib/mind-note-proposal';

interface Props {
  sessionId: string;
  currentDraft: { content: EditableMindNote; updatedAt: string };
  blocked?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onModified: (note: EditableMindNote, updatedAt: string) => void;
  /** Local fictional previews supply a closed transport; normal app uses fetch. */
  transport?: typeof fetch;
}

/** Proposed text lives only in this mounted view. The original is changed only
 * by explicit clinician apply through the existing version/recovery guarded API. */
export function MindNoteRewrite({
  sessionId,
  currentDraft,
  blocked = false,
  onBusyChange,
  onModified,
  transport = fetch,
}: Props) {
  const [instruction, setInstruction] = useState('');
  const [proposal, setProposal] = useState<MindNoteProposal | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [pending, setPending] = useState<'preview' | 'apply' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveUnknown, setSaveUnknown] = useState(false);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const busyOwned = useRef(false);
  const busyCallback = useRef(onBusyChange);
  busyCallback.current = onBusyChange;
  const proposalHeading = useRef<HTMLHeadingElement | null>(null);
  const instructionField = useRef<HTMLTextAreaElement | null>(null);
  const id = useId();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort();
      if (busyOwned.current) {
        busyOwned.current = false;
        busyCallback.current?.(false);
      }
    };
  }, []);
  useEffect(() => {
    if (proposal) proposalHeading.current?.focus();
    else if (message) instructionField.current?.focus();
  }, [proposal, saveUnknown, message]);
  const stale = proposal !== null && proposal.baseUpdatedAt !== currentDraft.updatedAt;
  const changes = proposal ? narrativeChanges(currentDraft.content, proposal.note) : [];

  async function run(operation: 'preview' | 'apply') {
    if (
      request.current ||
      blocked ||
      saveUnknown ||
      (operation === 'apply' && (!proposal || stale || !reviewed))
    )
      return;
    if (
      operation === 'preview' &&
      (instruction.trim().length < 3 || instruction.trim().length > 1000)
    )
      return;
    const controller = new AbortController();
    request.current = controller;
    const timeout = setTimeout(() => controller.abort(), operation === 'preview' ? 58_000 : 20_000);
    setPending(operation);
    busyOwned.current = true;
    onBusyChange?.(true);
    setError(null);
    setMessage(null);
    let unconfirmed = false;
    try {
      const response = await transport(
        `/api/v1/sessions/${sessionId}/${operation === 'preview' ? 'note/modify' : 'note-draft'}`,
        {
          method: operation === 'preview' ? 'POST' : 'PUT',
          headers: { 'content-type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify(
            operation === 'preview'
              ? { instruction, mode: 'PREVIEW', expectedUpdatedAt: currentDraft.updatedAt }
              : { note: proposal!.note, expectedUpdatedAt: proposal!.baseUpdatedAt },
          ),
        },
      );
      const payload: unknown = await response.json();
      if (payload === null || typeof payload !== 'object' || Array.isArray(payload))
        throw new Error('The response could not be read.');
      const body = payload as Record<string, unknown>;
      if (!response.ok)
        throw new Error(
          typeof body.error === 'string' ? body.error : `Request failed (${response.status}).`,
        );
      if (!mounted.current) return;
      // A transport or body reader can settle after cancellation. Ignoring a
      // late apply receipt must not restore "not applied" or release the save
      // boundary: the server may already have committed the note.
      if (controller.signal.aborted) throw new DOMException('Request aborted', 'AbortError');
      if (operation === 'preview') {
        setProposal(readMindNoteProposal(body, currentDraft.content, currentDraft.updatedAt));
        setReviewed(false);
      } else {
        const schema =
          'presentingConcerns' in currentDraft.content ? IntakeNoteV1Schema : TherapyNoteV1Schema;
        const saved = schema.safeParse(body.note);
        if (
          !saved.success ||
          typeof body.updatedAt !== 'string' ||
          !Number.isFinite(Date.parse(body.updatedAt))
        )
          throw new Error('The save receipt could not be read.');
        onModified(saved.data, body.updatedAt);
        setProposal(null);
        setReviewed(false);
        setInstruction('');
        setMessage('Reviewed changes saved to the draft. Signing and sharing are separate.');
      }
    } catch (failure) {
      if (!mounted.current) return;
      if (operation === 'apply') {
        unconfirmed = true;
        setSaveUnknown(true);
      }
      setError(
        operation === 'apply'
          ? `Could not confirm the save. Keep this review open and check the saved note before retrying. ${failure instanceof Error && failure.name !== 'AbortError' ? failure.message : ''}`
          : failure instanceof Error && failure.name !== 'AbortError'
            ? failure.message
            : 'The suggestion took too long. Your note has not changed; you can retry.',
      );
    } finally {
      clearTimeout(timeout);
      request.current = null;
      if (mounted.current) {
        setPending(null);
        if (!unconfirmed) {
          busyOwned.current = false;
          onBusyChange?.(false);
        }
      }
    }
  }

  return (
    <section aria-label="Review AI writing suggestions" className="space-y-4">
      <p className="max-w-prose text-sm text-[var(--color-ink-2)]">
        Ask for a wording change, then compare it before applying. AI can make mistakes; check the
        suggestion against the session.
      </p>
      {blocked && (
        <p role="status" className="text-sm">
          Finish the current note action or resolve saved edits before requesting or applying a
          suggestion.
        </p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void run('preview');
        }}
        className="space-y-3"
      >
        <label htmlFor={`${id}-instruction`} className="block text-sm font-semibold">
          What wording would you like to change?
        </label>
        <textarea
          ref={instructionField}
          id={`${id}-instruction`}
          rows={2}
          maxLength={1000}
          disabled={blocked || saveUnknown || pending !== null || proposal !== null}
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          placeholder="For example: make the existing plan more concise without changing its meaning."
          className="w-full rounded-xl border border-[var(--color-line)] bg-white p-3 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
        />
        {!proposal && (
          <Button
            type="submit"
            variant="secondary"
            disabled={blocked || pending !== null || instruction.trim().length < 3}
          >
            {pending === 'preview' ? 'Preparing suggestion…' : 'Preview suggested changes'}
          </Button>
        )}
      </form>
      {error && (
        <p role="alert" className="text-sm text-[var(--color-warn)]">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      {proposal && (
        <>
          <h3
            ref={proposalHeading}
            tabIndex={-1}
            className="rounded font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
          >
            {saveUnknown ? 'Save status unknown' : 'Proposed changes — not applied'}
          </h3>
          {saveUnknown && (
            <p role="alert" className="text-sm text-[var(--color-warn)]">
              The changes may already be saved. Reload the saved note to check before editing or
              signing. Reloading does not undo a save.
            </p>
          )}
          {stale ? (
            <p role="alert" className="text-sm text-[var(--color-warn)]">
              The note changed after this suggestion. Keep the current note and request a new
              preview.
            </p>
          ) : (
            <>
              {changes.length === 0 && (
                <p className="text-sm">
                  No narrative changes were suggested. Your note is unchanged.
                </p>
              )}
              <NoteProposalComparison changes={changes} />
              {changes.length > 0 && !saveUnknown && (
                <>
                  <p className="max-w-prose text-sm text-[var(--color-ink-2)]">
                    Only the sections above will change. Safety fields and modality stay unchanged.
                    Older generated summaries and evidence links will be cleared so they do not
                    misrepresent your corrected note.
                  </p>
                  <label className="flex min-h-11 items-start gap-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={reviewed}
                      disabled={blocked || pending !== null}
                      onChange={(event) => setReviewed(event.target.checked)}
                      className="mt-1 size-4"
                    />
                    I checked these changes against the session and want to use them.
                  </label>
                </>
              )}
            </>
          )}
          <div className="flex flex-wrap gap-3">
            {saveUnknown ? (
              <a
                href={`/app/sessions/${sessionId}?tab=note`}
                className="inline-flex min-h-11 items-center rounded-xl border border-[var(--color-accent)] px-4 py-2 font-medium text-[var(--color-accent)] focus-visible:outline focus-visible:outline-2"
              >
                Reload saved note
              </a>
            ) : (
              <>
                {changes.length > 0 && (
                  <Button
                    disabled={blocked || pending !== null || stale || !reviewed}
                    onClick={() => void run('apply')}
                  >
                    {pending === 'apply' ? 'Applying reviewed changes…' : 'Apply reviewed changes'}
                  </Button>
                )}
                <Button
                  variant="secondary"
                  disabled={pending !== null}
                  onClick={() => {
                    setProposal(null);
                    setReviewed(false);
                    setError(null);
                    setMessage('Suggestion dismissed. Your note has not changed.');
                  }}
                >
                  Keep current note
                </Button>
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}

export function NoteProposalComparison({
  changes,
}: {
  changes: ReturnType<typeof narrativeChanges>;
}) {
  return (
    <div className="space-y-5">
      {changes.map((change) => (
        <section key={change.field} aria-label={`${change.label} changes`} className="space-y-2">
          <h4 className="text-sm font-semibold">{change.label}</h4>
          <div className="grid min-w-0 gap-3 lg:grid-cols-2">
            <div className="min-w-0 rounded-xl border border-[var(--color-line-soft)] p-4">
              <p className="mb-2 text-sm font-medium">Current note</p>
              <p className="whitespace-pre-wrap break-words text-base leading-7">
                {change.before || '(Empty)'}
              </p>
            </div>
            <div className="min-w-0 rounded-xl border border-[var(--color-accent)] bg-[var(--color-accent-soft)] p-4">
              <p className="mb-2 text-sm font-medium">AI suggestion</p>
              <p className="whitespace-pre-wrap break-words text-base leading-7">
                {change.after || '(Empty)'}
              </p>
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}
