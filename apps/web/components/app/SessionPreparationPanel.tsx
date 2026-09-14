'use client';

import { useEffect, useId, useRef, useState } from 'react';
import {
  SessionPreparationClient,
  type PreparationClientState,
} from '@/lib/session-preparation-client';
import { formatMindWorkDate } from '@/lib/mind-session-work';
import { useUnsavedWorkGuard } from '@/lib/use-unsaved-work-guard';
import { Button } from '../ui/Button';

export type SessionPreparationPanelProps = {
  sessionId: string;
  clientId: string;
  clientName?: string;
  readOnly?: boolean;
  /** Unresolved explicit writes only; parents must prevent visit changes and starts while true. */
  onPendingChange?: (pending: boolean) => void;
  onDirtyChange?: (dirty: boolean) => void;
  /** Explicitly leaves unsaved wording behind without adopting it. */
  onSkip?: () => void;
  /** Explicitly injected transport for fictional previews/tests; ordinary usage keeps fetch. */
  request?: typeof fetch;
};

/** The key resets visit-local state before painting a different client or booking. */
export function SessionPreparationPanel(props: SessionPreparationPanelProps) {
  return <BoundSessionPreparationPanel key={`${props.clientId}:${props.sessionId}`} {...props} />;
}

function BoundSessionPreparationPanel({
  sessionId,
  clientId,
  clientName,
  readOnly = false,
  onPendingChange,
  onDirtyChange,
  onSkip,
  request,
}: SessionPreparationPanelProps) {
  const id = useId();
  const controller = useRef<SessionPreparationClient | null>(null);
  const context = useRef({ sessionId, clientId });
  const pendingCallback = useRef(onPendingChange);
  pendingCallback.current = onPendingChange;
  const dirtyCallback = useRef(onDirtyChange);
  dirtyCallback.current = onDirtyChange;
  const options = useRef({ readOnly, request });
  options.current = { readOnly, request };
  const [state, setState] = useState<PreparationClientState>({
    phase: 'loading',
    snapshot: null,
    draft: '',
    pending: false,
    message: null,
  });

  useEffect(() => {
    const client = new SessionPreparationClient(
      sessionId,
      clientId,
      (next) => {
        setState(next);
        pendingCallback.current?.(next.pending);
        dirtyCallback.current?.(next.draft !== (next.snapshot?.preparation?.body.focus ?? ''));
      },
      options.current.request,
      options.current.readOnly,
    );
    controller.current = client;
    void client.load();
    return () => {
      client.dispose();
      controller.current = null;
      pendingCallback.current?.(false);
      dirtyCallback.current?.(false);
    };
  }, [sessionId, clientId]);

  useEffect(() => controller.current?.setReadOnly(readOnly), [readOnly]);

  const bound = context.current.sessionId === sessionId && context.current.clientId === clientId;
  const snapshotMatches =
    !state.snapshot ||
    (state.snapshot.sessionId === sessionId && state.snapshot.clientId === clientId);
  const dirty = state.draft !== (state.snapshot?.preparation?.body.focus ?? '');
  useUnsavedWorkGuard(
    state.pending || dirty,
    'This preparation wording has not been saved. Leave it behind and continue?',
    state.pending,
  );

  // Defense beyond the keyed wrapper: never paint old PHI before effect cleanup on prop change.
  if (!bound || !snapshotMatches)
    return (
      <p role="status" className="text-sm text-[var(--color-ink-3)]">
        Checking this visit’s preparation…
      </p>
    );

  const editable = !readOnly && state.snapshot?.status === 'SCHEDULED';
  const canEdit = editable && ['ready', 'saved'].includes(state.phase) && !state.pending;
  const savedFocus = state.snapshot?.preparation?.body.focus;
  const preparationDateChanged =
    !!state.snapshot?.preparation &&
    !sameScheduledTime(state.snapshot.scheduledAt, state.snapshot.preparation.body.scheduledAt);
  const error = ['ambiguous', 'conflict', 'unavailable'].includes(state.phase);
  return (
    <section
      aria-labelledby={`${id}-title`}
      className="min-w-0 border-t border-[var(--color-line-soft)] pt-4"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 id={`${id}-title`} className="font-serif text-xl text-[var(--color-ink)]">
          Focus for this visit
        </h3>
        {!readOnly && <span className="text-xs text-[var(--color-ink-3)]">Optional</span>}
      </div>
      {state.snapshot && (
        <p className="mt-1 break-words text-xs leading-relaxed text-[var(--color-ink-3)]">
          {clientName ? `${clientName} — ` : ''}
          {formatMindWorkDate(state.snapshot.scheduledAt)}
        </p>
      )}
      <p
        id={`${id}-meaning`}
        className="mt-2 max-w-prose text-xs leading-relaxed text-[var(--color-ink-3)]"
      >
        Preparation — not evidence of what happened in the session. This does not add text to the
        note or send it to live AI.
      </p>

      {state.phase === 'loading' && (
        <p role="status" className="mt-3 text-sm text-[var(--color-ink-3)]">
          Checking saved preparation…
        </p>
      )}
      {state.message && (
        <p
          role={error ? 'alert' : 'status'}
          className={`mt-3 max-w-prose text-sm leading-relaxed ${error ? 'text-[var(--color-warn)]' : 'text-[var(--color-ink-2)]'}`}
        >
          {state.message}
        </p>
      )}

      {state.snapshot && state.phase !== 'loading' && (
        <>
          {savedFocus &&
            (!editable || dirty || state.phase === 'conflict' || preparationDateChanged) && (
              <div className="mt-3 border-l-2 border-[var(--color-accent)] pl-3">
                <p className="text-xs text-[var(--color-ink-3)]">
                  {error ? 'Last checked saved focus' : 'Saved focus'}
                </p>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed">
                  {savedFocus}
                </p>
                {!sameScheduledTime(
                  state.snapshot.scheduledAt,
                  state.snapshot.preparation!.body.scheduledAt,
                ) && (
                  <p className="mt-1 text-xs text-[var(--color-warn)]">
                    Prepared for {formatMindWorkDate(state.snapshot.preparation!.body.scheduledAt)}.
                    This visit’s scheduled time has since changed.
                  </p>
                )}
              </div>
            )}
          {!editable && !savedFocus && !error && (
            <p className="mt-3 text-sm text-[var(--color-ink-2)]">No saved focus for this visit.</p>
          )}
          {(editable || dirty) && (
            <div className="mt-3">
              <label htmlFor={`${id}-focus`} className="text-sm font-medium">
                {editable ? 'What would you like to focus on?' : 'Your unsaved wording'}
              </label>
              <textarea
                id={`${id}-focus`}
                aria-describedby={`${id}-meaning ${id}-count`}
                rows={3}
                maxLength={200}
                value={state.draft}
                readOnly={!canEdit}
                onChange={(event) => controller.current?.update(event.target.value)}
                className="mt-2 block w-full min-w-0 resize-y rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] px-3 py-2 text-sm leading-relaxed text-[var(--color-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] read-only:bg-[var(--color-bg)]"
              />
              <p id={`${id}-count`} className="mt-1 text-xs text-[var(--color-ink-3)]">
                {state.draft.length}/200 characters. Editing alone does not save.
              </p>
            </div>
          )}
          {!editable && !readOnly && (
            <p className="mt-3 text-xs leading-relaxed text-[var(--color-ink-3)]">
              Preparation is read-only once a visit starts or is closed. Record subsequent decisions
              in the session note.
            </p>
          )}
        </>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {editable && !state.pending && !error && state.phase !== 'loading' && (
          <>
            <Button
              type="button"
              size="sm"
              disabled={!canEdit || !state.draft.trim() || (!dirty && !preparationDateChanged)}
              onClick={() => void controller.current?.save()}
            >
              Use for this visit
            </Button>
            {savedFocus && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!canEdit}
                onClick={() => void controller.current?.save('CLEAR')}
              >
                Clear saved focus
              </Button>
            )}
          </>
        )}
        {state.phase === 'ambiguous' && (
          <Button type="button" size="sm" onClick={() => void controller.current?.retry()}>
            Retry same save
          </Button>
        )}
        {(state.phase === 'conflict' || state.phase === 'unavailable') && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void controller.current?.load(state.snapshot !== null || !!state.draft)}
          >
            {state.phase === 'conflict' ? 'Review latest saved focus' : 'Retry preparation'}
          </Button>
        )}
        {dirty && !state.pending && !onSkip && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => controller.current?.discardDraft()}
          >
            Discard unsaved wording
          </Button>
        )}
        {onSkip && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={state.pending}
            onClick={() => {
              if (controller.current?.discardDraft()) onSkip();
            }}
          >
            Skip without saving
          </Button>
        )}
      </div>
    </section>
  );
}

function sameScheduledTime(left: string, right: string) {
  return Date.parse(left) === Date.parse(right);
}
