import type { SpeakerSegment } from '@cureocity/contracts';
import { Badge } from '../ui/Badge';

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

export function TranscriptTab({ data }: { data: TranscriptPanelData }) {
  if (data.status === 'PENDING' || data.status === 'GENERATING') {
    return (
      <EmptyState
        title="Transcript not ready yet"
        body="Pass 1 (de-identify + diarize) is still running. The transcript will appear here automatically once it completes."
      />
    );
  }
  if (data.status === 'FAILED' && data.errorMessage) {
    return (
      <EmptyState
        title="Pass 1 failed"
        body={data.errorMessage}
        tone="warn"
      />
    );
  }
  if (!data.segments || data.segments.length === 0) {
    return (
      <EmptyState
        title="No transcript available"
        body={
          data.transcript
            ? 'Pass 1 returned a plain transcript without speaker diarization. Showing it raw below.'
            : 'No transcript was produced for this session. If you expected one, retry the note generation from the Notes tab.'
        }
        rawTranscript={data.transcript ?? undefined}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
        <span>{data.segments.length} segments</span>
        <span>Cost ₹{data.totalCostInr}</span>
        <span>Backend {data.backend ?? 'unknown'}</span>
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
