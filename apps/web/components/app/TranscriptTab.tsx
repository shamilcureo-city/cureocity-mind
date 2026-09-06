'use client';

import { useEffect, useState } from 'react';
import type { NoteDraft } from '@cureocity/contracts';
import type { SpeakerSegment } from '@cureocity/contracts';
import { Badge } from '../ui/Badge';
import { transcriptIsProcessing } from '../../lib/transcript-state';

interface TranscriptPanelData {
  status: string;
  segments: SpeakerSegment[] | null;
  transcript: string | null;
  totalCostInr: string;
  backend: string | null;
  errorMessage: string | null;
}

function formatTimestamp(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const SPEAKER_TONE: Record<SpeakerSegment['speaker'], 'accent' | 'warn' | 'muted'> = {
  therapist: 'accent',
  client: 'warn',
  unknown: 'muted',
};

const SPEAKER_LABEL: Record<SpeakerSegment['speaker'], string> = {
  therapist: 'Therapist',
  client: 'Client',
  unknown: 'Unknown',
};

export function TranscriptTab({
  data: initialData,
  sessionId,
}: {
  data: TranscriptPanelData;
  sessionId?: string;
}) {
  const [data, setData] = useState(initialData);
  const [pollError, setPollError] = useState<string | null>(null);
  useEffect(() => setData(initialData), [initialData]);
  const processing = transcriptIsProcessing(data.status);
  useEffect(() => {
    if (!sessionId || !processing) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      let again = true;
      try {
        const response = await fetch(`/api/v1/sessions/${sessionId}/note-draft`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) {
          if ([401, 403, 404].includes(response.status)) again = false;
          throw new Error('Could not refresh the transcript. Reload the page to retry.');
        }
        const draft = (await response.json()) as NoteDraft;
        if (controller.signal.aborted) return;
        setData((previous) => ({
          ...previous,
          status: draft.status,
          transcript: draft.transcript,
          segments: draft.speakerSegments,
          totalCostInr: draft.totalCostInr,
          errorMessage: draft.errorMessage,
        }));
        setPollError(null);
        again = transcriptIsProcessing(draft.status);
      } catch (error) {
        if (!controller.signal.aborted)
          setPollError(
            error instanceof Error ? error.message : 'Could not refresh the transcript.',
          );
      }
      if (again && !controller.signal.aborted) timer = setTimeout(() => void poll(), 3000);
    };
    timer = setTimeout(() => void poll(), 1500);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [sessionId, processing]);

  if (processing && !data.transcript && !data.segments?.length) {
    return (
      <EmptyState
        title="Transcript not ready yet"
        body={
          pollError ??
          (sessionId
            ? 'Transcription is still processing. This view will update automatically.'
            : 'Transcription is still processing. This is the transcript saved with your current draft.')
        }
      />
    );
  }
  if (data.status === 'FAILED' && !data.transcript && !data.segments?.length) {
    return (
      <EmptyState
        title="Transcript needs attention"
        body="No transcript was saved. Return to Review & Close to check the generation error and recovery options."
        tone="warn"
      />
    );
  }
  if (!data.segments || data.segments.length === 0) {
    return (
      <EmptyState
        title={data.transcript ? 'Saved transcript' : 'No transcript available'}
        body={
          data.transcript
            ? 'Speaker labels were not available. The saved transcript is shown below.'
            : 'No transcript was produced for this session. Return to Review & Close for recovery options.'
        }
        rawTranscript={data.transcript ?? undefined}
      />
    );
  }

  return (
    <div className="space-y-4">
      {processing && (
        <p role="status" className="text-sm text-[var(--color-ink-2)]">
          The saved transcript is available; the note is still processing.
        </p>
      )}
      {data.status === 'FAILED' && (
        <p role="status" className="text-sm text-[var(--color-warn)]">
          The saved transcript is available even though note generation needs attention.
        </p>
      )}
      {pollError && (
        <p role="alert" className="text-sm text-[var(--color-warn)]">
          {pollError}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
        <span>{data.segments.length} segments</span>
      </div>

      <ol className="space-y-3">
        {data.segments.map((seg, i) => (
          <li
            key={i}
            className="rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-4"
          >
            <header className="flex flex-wrap items-center gap-3 text-xs text-[var(--color-ink-3)]">
              <Badge tone={SPEAKER_TONE[seg.speaker]}>{SPEAKER_LABEL[seg.speaker]}</Badge>
              <span>
                {formatTimestamp(seg.startMs)} – {formatTimestamp(seg.endMs)}
              </span>
            </header>
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-[var(--color-ink)]">
              {seg.text}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}

function EmptyState({
  title,
  body,
  tone,
  rawTranscript,
}: {
  title: string;
  body: string;
  tone?: 'warn';
  rawTranscript?: string;
}) {
  return (
    <div
      className={`rounded-2xl border p-6 ${
        tone === 'warn'
          ? 'border-[var(--color-warn-border)] bg-[var(--color-warn-bg)]'
          : 'border-[var(--color-line-soft)] bg-[var(--color-surface)]'
      }`}
    >
      <h3 className="font-serif text-xl">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-2)]">{body}</p>
      {rawTranscript && (
        <pre className="mt-4 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--color-surface-2)] p-4 font-mono text-xs text-[var(--color-ink)]">
          {rawTranscript}
        </pre>
      )}
    </div>
  );
}
