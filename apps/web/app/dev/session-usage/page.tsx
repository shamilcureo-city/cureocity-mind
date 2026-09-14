import { notFound } from 'next/navigation';
import '@/app/app/mind-workspace.css';
import { SessionUsageDetails } from '@/components/app/SessionUsagePanel';
import { SessionUsageSummarySchema } from '@cureocity/contracts';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Mind usage · fictional local preview',
  robots: { index: false, follow: false },
};

/** Fictional amounts only: no database, account, microphone, gateway or paid AI calls. */
export default function SessionUsagePreview() {
  if (process.env.NODE_ENV !== 'development' || process.env.MIND_WORKSPACE_PREVIEW !== 'true')
    notFound();
  const base = SessionUsageSummarySchema.parse({
    version: 1,
    sessionId: 'fictional-usage-visit',
    recordedSubtotalInr: '2.2700',
    liveConnectionSubtotalInr: '2.0000',
    webCallSubtotalInr: '0.2700',
    legacySubtotalInr: null,
    lowerBound: false,
    coverage: 'PARTIAL',
    coverageReasons: [
      'Not reconciled with provider billing',
      'A connection has not reported its final usage',
      'Client-level AI, hidden retries, hosting and taxes are not included',
    ],
    connections: { registered: 2, receipted: 2, open: 1, finalReported: 1, incomplete: 0 },
    webCallRecords: 1,
    legacyOverlap: 'NONE',
    usageBasis: 'RECORDED_ESTIMATE',
    reconciliation: 'NOT_RECONCILED',
  });
  return (
    <main className="mind-workspace-shell min-h-screen bg-[var(--color-bg)] px-4 py-8 text-[var(--color-ink)] sm:px-8">
      <div className="mx-auto max-w-2xl space-y-6">
        <header className="space-y-2">
          <h1 className="font-serif text-3xl">Understand the recorded estimate.</h1>
          <p className="text-sm text-[var(--color-ink-2)]">
            Fictional local examples only. These are not real charges or a price per minute.
          </p>
        </header>
        {[
          ['Two connections and a web follow-up', base],
          [
            'Old and new records overlap',
            {
              ...base,
              recordedSubtotalInr: '2.7700',
              legacySubtotalInr: '2.5000',
              lowerBound: true,
              legacyOverlap: 'UNPROVEN' as const,
            },
          ],
          [
            'No receipt yet',
            {
              ...base,
              recordedSubtotalInr: null,
              liveConnectionSubtotalInr: null,
              webCallSubtotalInr: null,
              webCallRecords: 0,
              coverage: 'NO_RECORDED_USAGE' as const,
              connections: {
                registered: 1,
                receipted: 0,
                open: 1,
                finalReported: 0,
                incomplete: 0,
              },
            },
          ],
          [
            'A zero receipt, not a missing value',
            {
              ...base,
              recordedSubtotalInr: '0.0000',
              liveConnectionSubtotalInr: '0.0000',
              webCallSubtotalInr: null,
              webCallRecords: 0,
            },
          ],
        ].map(([title, summary]) => (
          <section key={String(title)} className="rounded-2xl bg-[var(--color-surface)] p-5">
            <h2 className="mb-4 font-serif text-xl">{String(title)}</h2>
            <SessionUsageDetails summary={summary as typeof base} />
          </section>
        ))}
      </div>
    </main>
  );
}
