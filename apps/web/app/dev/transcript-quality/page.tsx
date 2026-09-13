import { notFound } from 'next/navigation';
import '@/app/app/mind-workspace.css';
import { TranscriptTab } from '@/components/app/TranscriptTab';
import { LiveCostEstimate } from '@/components/app/LiveCostEstimate';
import { NoteEditingLayout } from '@/components/app/NoteEditingLayout';
import { SavedNoteProcessingDetails } from '@/components/app/SavedNoteProcessingDetails';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Mind transcript · local preview',
  robots: { index: false, follow: false },
};

/** Fictional rendering fixture. No account, recording, model or database calls. */
export default function TranscriptQualityPreview() {
  if (process.env['NODE_ENV'] !== 'development' || process.env['MIND_WORKSPACE_PREVIEW'] !== 'true')
    notFound();
  const segments = [
    {
      speaker: 'therapist' as const,
      startMs: 0,
      endMs: 4000,
      text: 'How have you been sleeping since we last spoke?',
    },
    {
      speaker: 'client' as const,
      startMs: 4500,
      endMs: 9000,
      text: 'ഇപ്പോൾ കുറച്ച് better ആണ്. I still wake up early sometimes.',
    },
    {
      speaker: 'therapist' as const,
      startMs: 9500,
      endMs: 14000,
      text: 'What do you notice when you wake up early?',
    },
    {
      speaker: 'unknown' as const,
      startMs: 14500,
      endMs: 17000,
      text: 'A quiet response that needs speaker review.',
    },
  ];
  const transcript = segments.map((segment) => segment.text).join(' ');
  const data = {
    status: 'COMPLETED',
    transcript,
    segments,
    totalCostInr: '0',
    backend: null,
    errorMessage: null,
  };
  return (
    <main className="mind-workspace-shell min-h-screen bg-[var(--color-bg)] px-5 py-8 text-[var(--color-ink)] sm:px-10">
      <div className="mx-auto max-w-6xl space-y-8">
        <header className="space-y-3">
          <p className="text-sm text-[var(--color-accent)]">Mind · fictional local preview</p>
          <h1 className="font-serif text-4xl">Your conversation, easy to review.</h1>
          <p className="text-[var(--color-ink-2)]">
            No recording, client record or paid AI request. Costs below are illustrative only.
          </p>
        </header>
        <section
          aria-label="Fictional note review"
          className="rounded-2xl bg-[var(--color-surface)] p-6"
        >
          <h2 className="mb-4 font-serif text-2xl">Review the note with its source</h2>
          <NoteEditingLayout mode="review" reference={<TranscriptTab data={data} />}>
            <article className="max-w-prose space-y-4 py-5 text-base leading-7">
              <p>
                The fictional client reports some improvement in sleep and occasional early waking.
              </p>
              <p>This demonstration does not establish a diagnosis or record an intervention.</p>
            </article>
          </NoteEditingLayout>
          <SavedNoteProcessingDetails
            costInr="2.27"
            chunkCount={segments.length}
            transcriptChars={transcript.length}
            region="fictional example"
          />
        </section>
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          <TranscriptTab data={data} />
          <LiveCostEstimate
            summary={{
              sessionId: 'fictional-preview',
              backend: 'vertex',
              windows: 12,
              pass1Calls: 12,
              pass2Calls: 2,
              reasoningCalls: 3,
              inputTokens: 1000,
              outputTokens: 500,
              costInr: 2.27,
              costBreakdown: { transcriptionInr: 0.6, notesInr: 1, reasoningInr: 0.67 },
              transcriptP50Ms: 200,
              transcriptP95Ms: 300,
              noteP50Ms: 1000,
              noteP95Ms: 1100,
              speechToTranscriptP50Ms: 800,
              speechToTranscriptP95Ms: 1200,
              elapsedMs: 60_000,
            }}
          />
        </div>
        <details className="rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-5">
          <summary className="cursor-pointer py-2 font-medium">
            Older transcript without saved speaker labels
          </summary>
          <div className="mt-4">
            <TranscriptTab data={{ ...data, segments: null }} />
          </div>
        </details>
        <details className="rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-5">
          <summary className="cursor-pointer py-2 font-medium">
            Example of a missing-speech warning
          </summary>
          <div className="mt-4">
            <TranscriptTab data={{ ...data, transcriptionWarning: true }} />
          </div>
        </details>
      </div>
    </main>
  );
}
