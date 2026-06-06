'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '../ui/Card';
import { PreFlightPanel, type PreFlightClient, type PreFlightResult } from './PreFlightPanel';
import { LiveRecorder } from './LiveRecorder';
import { FileUploadPanel } from './FileUploadPanel';
import { isDisplayCaptureSupported, type CaptureSource } from '@/lib/audio/use-session-recorder';

export type WorkflowMode = CaptureSource | 'upload';

interface Props {
  initialClients: PreFlightClient[];
}

type ShellState =
  | { kind: 'idle' }
  | { kind: 'preflight'; source: WorkflowMode }
  | { kind: 'recording'; ready: PreFlightResult; source: CaptureSource }
  | { kind: 'uploading'; ready: PreFlightResult };

const MODE_CARDS: {
  mode: WorkflowMode;
  title: string;
  body: string;
  tone: 'rose' | 'sage' | 'mint' | 'sky';
  icon: 'monitor' | 'mic' | 'pen' | 'upload';
}[] = [
  {
    mode: 'display',
    title: 'Record virtual session',
    body: 'For sessions over web tools like Jane, Owl, or Google Meet. Captures tab audio.',
    tone: 'rose',
    icon: 'monitor',
  },
  {
    mode: 'mic',
    title: 'Record in-person',
    body: 'Use this device’s microphone for an in-room session.',
    tone: 'sage',
    icon: 'mic',
  },
  {
    mode: 'dictation',
    title: 'Record a summary',
    body: 'Best for dictating key notes after a session.',
    tone: 'mint',
    icon: 'pen',
  },
  {
    mode: 'upload',
    title: 'Upload audio file',
    body: 'Drop a WAV / MP3 / M4A and the scribe will chunk + transcribe it.',
    tone: 'sky',
    icon: 'upload',
  },
];

export function RecordingShell({ initialClients }: Props) {
  const router = useRouter();
  const [shell, setShell] = useState<ShellState>({ kind: 'idle' });
  const [displaySupported, setDisplaySupported] = useState(true);

  useEffect(() => {
    setDisplaySupported(isDisplayCaptureSupported());
  }, []);

  function pickMode(mode: WorkflowMode): void {
    if (mode === 'display' && !displaySupported) return;
    setShell({ kind: 'preflight', source: mode });
  }

  function handleReady(result: PreFlightResult): void {
    if (shell.kind !== 'preflight') return;
    if (shell.source === 'upload') {
      setShell({ kind: 'uploading', ready: result });
    } else {
      setShell({ kind: 'recording', ready: result, source: shell.source });
    }
  }

  function handleFinished(): void {
    const sessionId =
      shell.kind === 'recording' || shell.kind === 'uploading' ? shell.ready.sessionId : null;
    setShell({ kind: 'idle' });
    if (sessionId) {
      router.push(`/app/sessions/${sessionId}`);
    } else {
      router.refresh();
    }
  }

  return (
    <>
      {shell.kind === 'idle' && (
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {MODE_CARDS.map((m) => {
            const isDisplay = m.mode === 'display';
            const disabled = isDisplay && !displaySupported;
            return (
              <button
                key={m.mode}
                type="button"
                disabled={disabled}
                onClick={() => pickMode(m.mode)}
                className={`group relative rounded-2xl border bg-white p-5 text-left transition-colors ${
                  disabled
                    ? 'cursor-not-allowed border-[var(--color-line)] opacity-60'
                    : 'border-[var(--color-line)] hover:border-[var(--color-ink)] hover:shadow-[0_18px_44px_-28px_rgba(15,27,42,0.18)]'
                }`}
              >
                <ModeSwatch tone={m.tone} icon={m.icon} />
                <h3 className="mt-4 font-medium">{m.title}</h3>
                <p className="mt-1 text-sm text-[var(--color-ink-2)]">{m.body}</p>
                {disabled && (
                  <span className="absolute right-4 top-4 rounded-full bg-[var(--color-warn-soft)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--color-warn)]">
                    Browser n/a
                  </span>
                )}
              </button>
            );
          })}
        </section>
      )}

      {shell.kind === 'preflight' && (
        <PreFlightPanel
          source={shell.source === 'upload' ? 'dictation' : shell.source}
          initialClients={initialClients}
          onCancel={() => setShell({ kind: 'idle' })}
          onReady={handleReady}
        />
      )}

      {shell.kind === 'recording' && (
        <LiveRecorder
          sessionId={shell.ready.sessionId}
          clientName={shell.ready.clientName}
          modality={shell.ready.modality}
          source={shell.source}
          onFinished={handleFinished}
        />
      )}

      {shell.kind === 'uploading' && (
        <FileUploadPanel
          sessionId={shell.ready.sessionId}
          clientName={shell.ready.clientName}
          modality={shell.ready.modality}
          onFinished={handleFinished}
        />
      )}

      {shell.kind === 'idle' && (
        <Card className="mt-6 p-5">
          <p className="text-sm text-[var(--color-ink-2)]">
            <strong>How it works.</strong> Pick a mode → confirm consent → start recording. Each
            30-second audio chunk is queued in this browser, uploaded in the background, and
            auto-resumes if your tab refreshes. The scribe (Sprint 2) turns the recording into a
            draft note within seconds of ending the session.
          </p>
        </Card>
      )}
    </>
  );
}

function ModeSwatch({
  tone,
  icon,
}: {
  tone: 'rose' | 'sage' | 'mint' | 'sky';
  icon: 'monitor' | 'mic' | 'pen' | 'upload';
}) {
  const palette: Record<typeof tone, string> = {
    rose: 'bg-[#fce8e6] text-[#9f3a4a]',
    sage: 'bg-[#e6efe7] text-[#385e44]',
    mint: 'bg-[#e6efe9] text-[#2d5f4d]',
    sky: 'bg-[#e3edf6] text-[#3a5d80]',
  };
  const path: Record<typeof icon, string> = {
    monitor: 'M3 5h18v11H3zM8 21h8M12 16v5',
    mic: 'M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3zM5 11a7 7 0 0 0 14 0M12 18v3',
    pen: 'M4 20h4l11-11-4-4L4 16v4zM14 6l4 4',
    upload: 'M12 17V4M5 11l7-7 7 7M5 20h14',
  };
  return (
    <span aria-hidden className={`grid h-9 w-9 place-items-center rounded-full ${palette[tone]}`}>
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={path[icon]} />
      </svg>
    </span>
  );
}
