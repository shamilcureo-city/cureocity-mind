import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

export const metadata: Metadata = { title: 'Shared from Cureocity Care' };
export const dynamic = 'force-dynamic';

/**
 * CG6 — /care/s/[token], the public share landing (docs/CARE_GROWTH_SYSTEM.md §8).
 * Renders a revocable, server-built card (numbers + labels only — no
 * clinical content exists in the snapshot by construction) plus the
 * honest-AI one-liner and the acquisition CTA. Every open is audited —
 * the artefact loop's conversion surface.
 */
export default async function CareSharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const card = await prisma.careShareCard.findUnique({
    where: { token },
    select: { id: true, kind: true, snapshot: true, revokedAt: true },
  });
  if (!card || card.revokedAt) notFound();

  await writeAudit({
    actorType: 'SYSTEM',
    action: 'CARE_SHARE_OPENED',
    targetType: 'CareShareCard',
    targetId: card.id,
    metadata: { kind: card.kind },
  });

  const s = card.snapshot as Record<string, unknown>;
  const signupsOpen = process.env['CARE_SIGNUPS_OPEN'] === 'true';

  return (
    <main className="mx-auto flex min-h-[80vh] w-full max-w-md flex-col justify-center px-5 py-10">
      <Card className="border-[var(--color-accent)]/30 bg-[var(--color-accent-soft)] p-6 text-center">
        {card.kind === 'MILESTONE' ? (
          <>
            <p className="font-serif text-2xl font-semibold">
              {Number(s['weeks']) > 0
                ? `${Number(s['weeks'])} week${Number(s['weeks']) === 1 ? '' : 's'} of showing up for myself 🌱`
                : 'Showing up for myself 🌱'}
            </p>
            <p className="mt-2 text-sm text-[var(--color-ink-2)]">
              {Number(s['totalSessions'])} session{Number(s['totalSessions']) === 1 ? '' : 's'} ·{' '}
              {Number(s['totalCheckins'])} check-in{Number(s['totalCheckins']) === 1 ? '' : 's'}
            </p>
          </>
        ) : null}
        {card.kind === 'VERDICT' ? (
          <>
            <p className="font-serif text-2xl font-semibold">
              My {s['instrumentKey'] === 'GAD7' ? 'anxiety' : 'mood'} score moved{' '}
              {Number(s['baselineScore'])} → {Number(s['latestScore'])}.
            </p>
            <p className="mt-2 text-sm text-[var(--color-ink-2)]">
              Measured the way clinicians measure it ({String(s['instrumentKey'])}).
            </p>
            <p className="mt-2 text-[12px] text-[var(--color-ink-3)]">
              One person&apos;s numbers, not a promise.
            </p>
          </>
        ) : null}
        {card.kind === 'GRADUATION' ? (
          <>
            <p className="font-serif text-2xl font-semibold">
              I finished my plan. {Number(s['totalSessions'])} sessions — and my therapist agreed it
              was time to go.
            </p>
            <p className="mt-2 text-sm text-[var(--color-ink-2)]">
              Some apps fight to keep you. This one celebrated me leaving.
            </p>
          </>
        ) : null}
        <p className="mt-4 text-[11px] uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
          Cureocity Care
        </p>
      </Card>

      <Card className="mt-4 p-4 text-center text-sm">
        <p>
          An AI therapist that shows its work — real voice sessions in your language, a written
          plan, progress measured honestly. And we say plainly: it&apos;s an AI.
        </p>
        {signupsOpen ? (
          <ButtonLink href="/care/login" className="mt-3 w-full">
            Start free — 2 sessions every week
          </ButtonLink>
        ) : (
          <ButtonLink href="/care" variant="secondary" className="mt-3 w-full">
            Join the waitlist →
          </ButtonLink>
        )}
      </Card>

      <p className="mt-4 text-center">
        <Link
          href="/care"
          className="text-sm text-[var(--color-ink-3)] underline-offset-2 hover:underline"
        >
          About Cureocity Care →
        </Link>
      </p>
      <p className="mt-6 text-center text-[11px] text-[var(--color-ink-3)]">
        AI software, not a person; not medical diagnosis, treatment, or a promise of outcomes.
      </p>
    </main>
  );
}
