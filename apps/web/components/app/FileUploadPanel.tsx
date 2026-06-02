'use client';

import { useState } from 'react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Label, FieldError } from '../ui/Field';
import { uploadAudioFile } from '@/lib/audio/upload-file';

interface Props {
  sessionId: string;
  clientName: string;
  modality: string;
  onFinished: () => void;
}

type Phase = 'pick' | 'uploading' | 'done' | 'error';

export function FileUploadPanel({ sessionId, clientName, modality, onFinished }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>('pick');
  const [progress, setProgress] = useState({ decoded: 0, total: 1, chunksUploaded: 0 });
  const [error, setError] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState(0);

  async function run(): Promise<void> {
    if (!file) return;
    setError(null);
    setPhase('uploading');
    try {
      const result = await uploadAudioFile({
        sessionId,
        file,
        onProgress: setProgress,
      });
      setDurationMs(result.durationMs);
      const end = await fetch(`/api/v1/sessions/${sessionId}/end`, { method: 'POST' });
      if (!end.ok) {
        const body = (await end.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `End failed (${end.status})`);
      }
      setPhase('done');
    } catch (e) {
      setError((e as Error).message);
      setPhase('error');
    }
  }

  const pct =
    progress.total === 0 ? 0 : Math.min(100, Math.round((progress.decoded / progress.total) * 100));

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] px-6 py-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-3)]">
            Upload audio
          </p>
          <p className="mt-0.5 text-base font-medium">{clientName}</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-[var(--color-ink-2)]">
          <Badge tone="muted">Upload</Badge>
          <Badge tone="muted">{modality}</Badge>
        </div>
      </div>

      <div className="px-6 py-6">
        {phase === 'pick' && (
          <div className="space-y-4">
            <div>
              <Label htmlFor="audio-file" hint="WAV, MP3, M4A, FLAC, WebM/Opus">
                Audio file
              </Label>
              <input
                id="audio-file"
                type="file"
                accept="audio/*"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm file:mr-4 file:rounded-full file:border-0 file:bg-[var(--color-accent)] file:px-4 file:py-2 file:text-sm file:text-white hover:file:bg-[var(--color-accent-hover)]"
              />
            </div>
            {file && (
              <p className="text-sm text-[var(--color-ink-2)]">
                <span className="font-medium">{file.name}</span> — {formatBytes(file.size)}
              </p>
            )}
            <FieldError message={error} />
            <Button onClick={run} disabled={!file}>
              Decode + upload
            </Button>
          </div>
        )}

        {phase === 'uploading' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-[var(--color-ink-2)]">Decoding + chunking…</span>
              <span className="tabular-nums">{pct}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[var(--color-line-soft)]">
              <div
                className="h-full bg-[var(--color-accent)] transition-[width]"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-xs text-[var(--color-ink-3)]">
              {progress.chunksUploaded} chunk{progress.chunksUploaded === 1 ? '' : 's'} written
            </p>
          </div>
        )}

        {phase === 'done' && (
          <div className="space-y-3">
            <p className="font-serif text-xl text-[var(--color-accent)]">
              Upload complete · {progress.chunksUploaded} chunks
            </p>
            <p className="text-sm text-[var(--color-ink-2)]">
              Audio duration: {formatDuration(durationMs)}. The session is now COMPLETED — note
              generation (Sprint 2) will run from the session detail page.
            </p>
            <Button onClick={onFinished}>Back to sessions</Button>
          </div>
        )}

        {phase === 'error' && (
          <div className="space-y-3">
            <div className="rounded-xl border border-[var(--color-warn)] bg-[var(--color-warn-soft)] px-4 py-3 text-sm text-[var(--color-warn)]">
              {error}
            </div>
            <Button variant="secondary" onClick={() => setPhase('pick')}>
              Try again
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}
