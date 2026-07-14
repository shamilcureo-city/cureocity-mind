import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { Card } from '@/components/ui/Card';

export const metadata: Metadata = {
  title: 'Transparency — Cureocity Care',
  description:
    'Published numbers from the audit log: sessions, safety pauses, suppressed messages, graduations. We publish our numbers because trust should be checkable.',
};
export const dynamic = 'force-dynamic';

/**
 * CG6 — /care/transparency (docs/CARE_GROWTH_SYSTEM.md §8): aggregate-only
 * counts rendered straight from the audit spine — the artefact no
 * competitor can produce, because their engagement rails aren't audited.
 * No cohorts, no user-level slices, nothing reversible.
 */
export default async function CareTransparencyPage() {
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const count = (action: string): Promise<number> =>
    prisma.auditLog.count({
      where: { action: action as never, createdAt: { gte: since } },
    });

  const [sessions, holds, escalations, suppressed, revoked, graduations] = await Promise.all([
    count('CARE_SESSION_COMPLETED'),
    count('CARE_SAFETY_HOLD_SET'),
    count('CARE_CRISIS_ESCALATED'),
    count('CARE_NUDGE_SUPPRESSED'),
    count('CARE_SHARE_REVOKED'),
    count('CARE_GRADUATED'),
  ]);

  const rows: Array<[string, number, string]> = [
    ['Sessions completed', sessions, 'Voice sessions that ran start to finish.'],
    [
      'Safety pauses set',
      holds,
      'Times the product paused itself and put human hotlines first — from any signal: a phrase, the SOS button, a check-in answer, or a report re-screen.',
    ],
    ['Crisis escalations', escalations, 'Sessions stopped mid-conversation for safety.'],
    [
      'Messages we did NOT send',
      suppressed,
      'Outbound nudges blocked by the suppression rules (holds, recent crisis, elevated risk, declining mood) — recorded, so "we never ping you when it\'s heavy" is checkable.',
    ],
    ['Share links taken down', revoked, 'Users revoking their own share cards — one tap.'],
    [
      'Graduations',
      graduations,
      'Accounts the product itself recommended step down from — billing stopped by us. Getting better and leaving is the outcome we work for.',
    ],
  ];

  return (
    <main className="mx-auto w-full max-w-md px-5 py-10 md:max-w-2xl">
      <h1 className="font-serif text-3xl font-semibold">We publish our numbers.</h1>
      <p className="mt-3 text-[15px] text-[var(--color-ink-2)]">
        Every safety-relevant event in Cureocity Care writes an audit record. These are the last 90
        days, aggregate only — because &ldquo;trust us&rdquo; should be checkable.
      </p>
      <div className="mt-6 space-y-3">
        {rows.map(([label, n, sub]) => (
          <Card key={label} className="flex items-baseline justify-between gap-4 p-4">
            <div>
              <p className="text-sm font-semibold">{label}</p>
              <p className="mt-0.5 text-[12px] text-[var(--color-ink-3)]">{sub}</p>
            </div>
            <span className="font-serif text-2xl font-semibold tabular-nums">{n}</span>
          </Card>
        ))}
      </div>
      <p className="mt-6 text-[12px] text-[var(--color-ink-3)]">
        How the safety machinery behaves:{' '}
        <Link href="/care/safety" className="font-semibold underline-offset-2 hover:underline">
          /care/safety
        </Link>
        . Aggregates only — no cohorts, no user-level data, nothing reversible.
      </p>
      <p className="mt-4 text-center">
        <Link
          href="/care"
          className="text-sm text-[var(--color-ink-3)] underline-offset-2 hover:underline"
        >
          ← About Cureocity Care
        </Link>
      </p>
    </main>
  );
}
