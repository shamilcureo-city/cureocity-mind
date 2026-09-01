'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ClientPicker, type ClientTileEntry } from './ClientPicker';
import { NewClientForm } from './NewClientForm';
import { RecordConfirmStrip } from './RecordConfirmStrip';
import { LiveRecorder } from './LiveRecorder';
import { FileUploadPanel } from './FileUploadPanel';
import type { RecordReady } from './record-types';

type ConfirmMode = 'live-capture' | 'dictation' | 'upload';

interface Props {
  clients: ClientTileEntry[];
  /** TS6 — deep link (`/app?record=<clientId>`): open the confirm strip for
   *  this client directly (the Today card's record / resume-batch path). */
  initialClientId?: string | null;
  initialSessionId?: string | null;
  initialCapture?: 'LIVE' | 'BATCH' | null;
  /** TS6 — the therapist's preferred in-person capture (live vs batch). */
  defaultCapture?: 'LIVE' | 'BATCH';
  /** VS1 — server-computed livekitConfigured(); gates the Virtual option. */
  videoEnabled?: boolean;
}

type Intent = 'live' | 'dictation' | 'upload';

type ShellState =
  | { kind: 'pick'; intent: Intent }
  | { kind: 'new-client'; intent: Intent }
  | { kind: 'confirm'; client: { id: string; fullName: string }; mode: ConfirmMode }
  | { kind: 'recording'; ready: RecordReady }
  | { kind: 'uploading'; ready: RecordReady };

const INTENT_MODE: Record<Intent, ConfirmMode> = {
  live: 'live-capture',
  dictation: 'dictation',
  upload: 'upload',
};

/**
 * Sprint 23 — Record entry surface, rebuilt client-first.
 *
 * The old shell forced the therapist to pick a capture mode (mic /
 * display / dictation / upload) BEFORE picking a client, which inverts
 * the clinician's mental model. The new shell asks "who are you with
 * today?" first and treats the capture method as a secondary choice
 * (in the confirm strip) — except for genuinely different intents
 * (dictation = post-hoc, upload = async) which surface as secondary
 * actions below the picker.
 *
 * State machine:
 *   pick(live)        → confirm(live-capture)        → recording
 *                    OR new-client → confirm(live-capture) → recording
 *   pick(dictation)   → confirm(dictation)            → recording
 *   pick(upload)      → confirm(upload)               → uploading
 *
 * `NewClientForm` creates ONLY the client and then joins the same confirm
 * step as everyone else. It used to create the session, snapshot consent,
 * start it and jump straight to the recorder — so submitting the form put
 * a therapist instantly on air, and a new client could never use the live
 * scribe (that choice lives in the confirm strip). Intake is where the
 * live copilot matters most, so both paths now converge.
 *
 * Neither surface pre-fills a modality: intake is how you decide it, and
 * the confirm strip only displays what the server-side cascade inferred.
 */
export function RecordingShell({
  clients,
  initialClientId = null,
  initialSessionId = null,
  initialCapture = null,
  defaultCapture,
  videoEnabled = true,
}: Props) {
  const router = useRouter();
  const [shell, setShell] = useState<ShellState>(() => {
    // TS6 — arriving via /app?record=<clientId> lands straight on the confirm
    // strip for that client (an unknown id just falls back to the picker).
    const preselected = initialClientId ? clients.find((c) => c.id === initialClientId) : undefined;
    return preselected
      ? {
          kind: 'confirm',
          client: { id: preselected.id, fullName: preselected.fullName },
          mode: 'live-capture',
        }
      : { kind: 'pick', intent: 'live' };
  });

  function handleReady(result: RecordReady, mode: ConfirmMode): void {
    if (mode === 'upload') {
      setShell({ kind: 'uploading', ready: result });
    } else {
      setShell({ kind: 'recording', ready: result });
    }
  }

  function handleFinished(): void {
    const sessionId =
      shell.kind === 'recording' || shell.kind === 'uploading' ? shell.ready.sessionId : null;
    setShell({ kind: 'pick', intent: 'live' });
    if (sessionId) {
      // Land on the copilot board, not Notes — the review work lives there and
      // the flat tab bar gives no sequencing cue that it is waiting.
      router.push(`/app/sessions/${sessionId}`);
    } else {
      router.refresh();
    }
  }

  if (shell.kind === 'pick') {
    return (
      <>
        {shell.intent !== 'live' && (
          <p className="mb-3 text-xs text-[var(--color-ink-3)]">
            {shell.intent === 'dictation' ? 'Dictating a summary' : 'Uploading audio'} — pick the
            client this is about.{' '}
            <button
              type="button"
              onClick={() => setShell({ kind: 'pick', intent: 'live' })}
              className="text-[var(--color-accent)] underline"
            >
              Cancel
            </button>
          </p>
        )}
        <ClientPicker
          clients={clients}
          onPickClient={(c) => {
            setShell({ kind: 'confirm', client: c, mode: INTENT_MODE[shell.intent] });
          }}
          onNewClient={() => setShell({ kind: 'new-client', intent: shell.intent })}
          onDictation={() => setShell({ kind: 'pick', intent: 'dictation' })}
          onUpload={() => setShell({ kind: 'pick', intent: 'upload' })}
        />
      </>
    );
  }

  if (shell.kind === 'new-client') {
    // The therapist's intent (dictation / upload / live) survives the detour
    // through the new-client form — it used to be silently reset to live.
    const intent = shell.intent;
    return (
      <NewClientForm
        onCancel={() => setShell({ kind: 'pick', intent })}
        onCreated={(client) => {
          // The picker's client list is server-rendered; without a refresh a
          // "← Back" after this create shows a list WITHOUT the new client,
          // which reads as "the create failed" and invites a duplicate.
          router.refresh();
          setShell({ kind: 'confirm', client, mode: INTENT_MODE[intent] });
        }}
      />
    );
  }

  if (shell.kind === 'confirm') {
    const mode = shell.mode;
    return (
      <RecordConfirmStrip
        clientId={shell.client.id}
        clientName={shell.client.fullName}
        mode={mode}
        defaultCapture={initialCapture ?? defaultCapture ?? 'LIVE'}
        expectedSessionId={initialSessionId}
        videoEnabled={videoEnabled}
        onCancel={() => setShell({ kind: 'pick', intent: 'live' })}
        onReady={(ready) => handleReady(ready, mode)}
      />
    );
  }

  if (shell.kind === 'recording') {
    return (
      <LiveRecorder
        sessionId={shell.ready.sessionId}
        clientId={shell.ready.clientId}
        clientName={shell.ready.clientName}
        modality={shell.ready.modality}
        source={shell.ready.source}
        selectedDeviceId={shell.ready.selectedDeviceId}
        authorizeMindAfterCaptureActive={shell.ready.startAfterCaptureActive === true}
        onFinished={handleFinished}
      />
    );
  }

  // uploading
  return (
    <FileUploadPanel
      sessionId={shell.ready.sessionId}
      clientName={shell.ready.clientName}
      modality={shell.ready.modality}
      onFinished={handleFinished}
    />
  );
}
