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
  /** TS6 — the therapist's preferred in-person capture (live vs batch). */
  defaultCapture?: 'LIVE' | 'BATCH';
}

type ShellState =
  | { kind: 'pick'; intent: 'live' | 'dictation' | 'upload' }
  | { kind: 'new-client' }
  | { kind: 'confirm'; client: { id: string; fullName: string }; mode: ConfirmMode }
  | { kind: 'recording'; ready: RecordReady }
  | { kind: 'uploading'; ready: RecordReady };

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
 *                    OR new-client                    → recording
 *   pick(dictation)   → confirm(dictation)            → recording
 *   pick(upload)      → confirm(upload)               → uploading
 *
 * For new clients the entire flow collapses into `NewClientForm`,
 * which avoids the modality/language pickers entirely (intake is how
 * you decide modality — pre-filling a default would be clinically
 * wrong).
 */
export function RecordingShell({ clients, initialClientId = null, defaultCapture }: Props) {
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
            const mode: ConfirmMode =
              shell.intent === 'dictation'
                ? 'dictation'
                : shell.intent === 'upload'
                  ? 'upload'
                  : 'live-capture';
            setShell({ kind: 'confirm', client: c, mode });
          }}
          onNewClient={() => setShell({ kind: 'new-client' })}
          onDictation={() => setShell({ kind: 'pick', intent: 'dictation' })}
          onUpload={() => setShell({ kind: 'pick', intent: 'upload' })}
        />
      </>
    );
  }

  if (shell.kind === 'new-client') {
    return (
      <NewClientForm
        onCancel={() => setShell({ kind: 'pick', intent: 'live' })}
        onReady={(ready) => setShell({ kind: 'recording', ready })}
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
        defaultCapture={defaultCapture ?? 'LIVE'}
        onCancel={() => setShell({ kind: 'pick', intent: 'live' })}
        onReady={(ready) => handleReady(ready, mode)}
      />
    );
  }

  if (shell.kind === 'recording') {
    return (
      <LiveRecorder
        sessionId={shell.ready.sessionId}
        clientName={shell.ready.clientName}
        modality={shell.ready.modality}
        source={shell.ready.source}
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
