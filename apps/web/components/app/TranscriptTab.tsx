'use client';

import { useEffect, useState } from 'react';
import type { NoteDraft } from '@cureocity/contracts';
import { containsTranscriptionArtifact, type SpeakerSegment } from '@cureocity/contracts';
import { Badge } from '../ui/Badge';
import { transcriptIsProcessing } from '../../lib/transcript-state';
import { TRANSCRIPTION_REVIEW_WARNING, transcriptParagraphs } from '../../lib/saved-transcript';
import { TRANSCRIPT_UNAVAILABLE_MESSAGE } from '../../lib/note-transcript-view';

interface TranscriptPanelData {
  status: string;
  segments: SpeakerSegment[] | null;
  transcript: string | null;
  totalCostInr: string;
  backend: string | null;
  errorMessage: string | null;
  transcriptionWarning?: boolean;
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
  unknown: 'Speaker not identified',
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
  const hasArtifact =
    containsTranscriptionArtifact(data.transcript ?? '') ||
    (data.segments?.some((s) => containsTranscriptionArtifact(s.text)) ?? false);
  const needsReview =
    hasArtifact || data.transcriptionWarning || data.errorMessage === TRANSCRIPTION_REVIEW_WARNING;
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

  if (data.errorMessage === TRANSCRIPT_UNAVAILABLE_MESSAGE) {
    return (
      <EmptyState
        title="Transcript unavailable"
        body={TRANSCRIPT_UNAVAILABLE_MESSAGE}
        tone="warn"
      />
    );
  }
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
        body="No transcript was saved. Return to Review & finish to check the generation error and recovery options."
        tone="warn"
      />
    );
  }
  if (!data.segments || data.segments.length === 0) {
    return (
      <div className="space-y-4">
        {needsReview && <TranscriptWarning hasArtifact={hasArtifact} />}
        <EmptyState
          title={data.transcript ? 'Saved transcript' : 'No transcript available'}
          body={
            data.transcript
              ? 'Speaker labels were not saved for this session. The words are shown as readable paragraphs; we have not guessed who said what.'
              : 'No transcript was produced for this session. Return to Review & finish for recovery options.'
          }
          rawTranscript={data.transcript ?? undefined}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {needsReview && <TranscriptWarning hasArtifact={hasArtifact} />}
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
        <span>{data.segments.length} conversation turns · review speaker labels</span>
      </div>

      <ol aria-label="Saved conversation" className="space-y-3">
        {data.segments.map((seg, i) => (
          <li
            key={i}
            className={`max-w-[92%] rounded-2xl border border-[var(--color-line-soft)] p-4 ${seg.speaker === 'therapist' ? 'ml-auto bg-[var(--color-accent-soft)]' : 'mr-auto bg-[var(--color-surface)]'}`}
          >
            <header className="flex flex-wrap items-center gap-3 text-xs text-[var(--color-ink-3)]">
              <Badge tone={SPEAKER_TONE[seg.speaker]}>{SPEAKER_LABEL[seg.speaker]}</Badge>
              <span>
                {formatTimestamp(seg.startMs)} – {formatTimestamp(seg.endMs)}
              </span>
            </header>
            <p className="mt-2 whitespace-pre-line break-words text-base leading-7 text-[var(--color-ink)]">
              {seg.text}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}

function TranscriptWarning({ hasArtifact }: { hasArtifact: boolean }) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-[var(--color-warn-border)] bg-[var(--color-warn-bg)] p-4 text-sm text-[var(--color-warn)]"
    >
      <strong>Transcript needs review</strong>
      <p className="mt-1">
        {hasArtifact
          ? 'This saved transcript contains invalid AI placeholder text. The original record is unchanged. Do not sign or share the note until the transcript and note have been reviewed and corrected.'
          : TRANSCRIPTION_REVIEW_WARNING}
      </p>
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
        <div
          aria-label="Saved transcript without speaker labels"
          className="mt-5 max-w-prose space-y-4 break-words text-base leading-8 text-[var(--color-ink)]"
        >
          {transcriptParagraphs(rawTranscript).map((paragraph, i) => (
            <p key={i}>{paragraph}</p>
          ))}
        </div>
      )}
    </div>
  );
}
