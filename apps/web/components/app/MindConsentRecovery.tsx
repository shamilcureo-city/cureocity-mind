'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { useUnsavedWorkGuard } from '@/lib/use-unsaved-work-guard';
import type {
  MindConsentRecoveryInput,
  MindConsentRecoveryState,
} from '@/lib/mind-consent-recovery';
import {
  ConsentRecoveryRequestError,
  loadConsentRecovery,
  saveConsentRecovery,
} from '@/lib/mind-consent-recovery-client';

const OPTIONS = [
  ['AUDIO_RECORDING', 'The client agrees to audio recording for this session.'],
  ['AI_NOTE_GENERATION', 'The client agrees to AI-assisted notes from this session.'],
  [
    'CROSS_BORDER_PROCESSING',
    'The client agrees to AI processing of the transcript outside India.',
  ],
] as const;
type Scope = (typeof OPTIONS)[number][0];
const unchecked = (): Record<Scope, boolean> => ({
  AUDIO_RECORDING: false,
  AI_NOTE_GENERATION: false,
  CROSS_BORDER_PROCESSING: false,
});
const defaultTransport = { load: loadConsentRecovery, save: saveConsentRecovery };

/** Mounted only after capture is stopped and token authorization reports a consent failure. */
export function MindConsentRecovery({
  sessionId,
  onConfirmed,
  onOpenSession,
  transport = defaultTransport,
}: {
  sessionId: string;
  onConfirmed: () => void;
  onOpenSession: () => void;
  /** Complete transport replacement for the isolated, no-network design preview. */
  transport?: typeof defaultTransport;
}) {
  const [state, setState] = useState<MindConsentRecoveryState | null>(null);
  const [checks, setChecks] = useState(unchecked);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadRequired, setReloadRequired] = useState(false);
  const [reload, setReload] = useState(0);
  const operation = useRef<MindConsentRecoveryInput | null>(null);
  const inFlight = useRef(false);
  const alive = useRef(false);
  const abortSave = useRef<AbortController | null>(null);
  const dirty = Object.values(checks).some(Boolean);
  useUnsavedWorkGuard(
    dirty,
    'This consent confirmation has not been saved. Leave this form?',
    busy,
  );

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      abortSave.current?.abort();
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setState(null);
    setError(null);
    setReloadRequired(false);
    setChecks(unchecked());
    operation.current = null;
    void transport
      .load(sessionId, AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]))
      .then((next) => {
        if (!controller.signal.aborted) setState(next);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof ConsentRecoveryRequestError
              ? cause.message
              : 'The consent details could not be loaded. Recording remains off. Reload to try again, or open the session record.',
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [sessionId, reload, transport]);

  async function save() {
    if (inFlight.current || !state || !Object.values(checks).every(Boolean) || reloadRequired)
      return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const controller = new AbortController();
    abortSave.current = controller;
    try {
      operation.current ??= {
        operationId: crypto.randomUUID(),
        expectedRevision: state.revision,
        confirmations: {
          AUDIO_RECORDING: true,
          AI_NOTE_GENERATION: true,
          CROSS_BORDER_PROCESSING: true,
        },
      };
      await transport.save(
        sessionId,
        operation.current,
        AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
      );
      if (!alive.current) return;
      setChecks(unchecked());
      onConfirmed();
    } catch (cause) {
      if (!alive.current) return;
      setError(
        cause instanceof ConsentRecoveryRequestError
          ? cause.message
          : 'The save was not confirmed. Your choices are still here; retry the same confirmation. Recording remains off.',
      );
      if (cause instanceof ConsentRecoveryRequestError && cause.needsReload)
        setReloadRequired(true);
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  }

  return (
    <Card className="border-amber-300 bg-amber-50 p-5 text-sm text-amber-950">
      <section aria-labelledby="mind-consent-recovery-title" aria-busy={loading || busy}>
        <h2 id="mind-consent-recovery-title" className="font-semibold">
          Confirm consent to continue
        </h2>
        <p className="mt-2">
          Recording is off. This session’s consent record needs checking before the live scribe can
          continue. This does not mean the client never consented.
        </p>
        <p className="mt-2">
          Stay on this session: existing notes and transcribed words are kept in this view.
        </p>
        {loading && (
          <p role="status" className="mt-4">
            Checking this session’s consent…
          </p>
        )}
        {state?.ready && !reloadRequired ? (
          <div className="mt-4 space-y-3">
            <p role="status">
              The server confirms current consent is on file. Returning to the controls does not
              start recording.
            </p>
            <Button onClick={onConfirmed}>Return to recording controls</Button>
          </div>
        ) : (
          state && (
            <>
              <fieldset disabled={busy || reloadRequired} className="mt-4 space-y-3">
                <legend className="mb-2 font-medium">
                  Discuss these permissions with the client, then confirm only what they agreed.
                </legend>
                {OPTIONS.map(([scope, label]) => (
                  <label
                    key={scope}
                    className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-amber-200 bg-white p-3"
                  >
                    <input
                      type="checkbox"
                      style={{ scrollMarginTop: '12rem' }}
                      className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-accent)]"
                      checked={checks[scope]}
                      onChange={(event) =>
                        setChecks((previous) => ({ ...previous, [scope]: event.target.checked }))
                      }
                    />
                    <span>
                      {label}
                      <span className="mt-1 block text-xs text-[var(--color-ink-2)]">
                        {!state.scopes.find((item) => item.scope === scope)?.sessionAcknowledged
                          ? 'Not recorded in this session’s consent snapshot.'
                          : state.scopes.find((item) => item.scope === scope)?.standingStatus !==
                              'GRANTED'
                            ? 'Current permission needs reconfirmation.'
                            : 'Already on file; confirm again for this recovery.'}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <p className="mt-3">
                This confirmation applies from now. It does not authorize earlier recording or
                processing. If the client does not agree to every required permission, do not use
                the live scribe.
              </p>
              <p className="mt-2">
                Saving does not start the microphone. You will choose when to resume, and the server
                will check consent again.
              </p>
              {!reloadRequired && (
                <Button
                  className="mt-4"
                  disabled={busy || !Object.values(checks).every(Boolean)}
                  onClick={() => void save()}
                >
                  {busy
                    ? 'Saving confirmation…'
                    : operation.current
                      ? 'Retry consent confirmation'
                      : 'Save consent confirmation'}
                </Button>
              )}
            </>
          )
        )}
        {error && (
          <p role="alert" className="mt-4">
            {error}
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-3">
          {(!state || reloadRequired) && !loading && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => setReload((count) => count + 1)}
            >
              Reload consent details
            </Button>
          )}
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              if (
                !dirty ||
                window.confirm(
                  'This consent confirmation has not been saved. Open the session record without saving it?',
                )
              )
                onOpenSession();
            }}
          >
            Open this session record
          </Button>
        </div>
      </section>
    </Card>
  );
}
