import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { DemoClientButton } from '@/components/app/DemoClientButton';
import { buildFirstRunJourney, hasCompletedRoleplaySession } from '@/lib/first-run-journey';
import { prisma } from '@/lib/prisma';

interface Props {
  psychologistId: string;
}

export async function FirstRunChecklist({ psychologistId }: Props) {
  const [realClients, realSessions, reviewedNotes, demoClient] = await Promise.all([
    prisma.client.count({ where: { psychologistId, deletedAt: null, isDemo: false } }),
    prisma.session.count({
      where: { psychologistId, status: 'COMPLETED', client: { isDemo: false } },
    }),
    prisma.therapyNote.count({
      where: { session: { psychologistId, client: { isDemo: false } } },
    }),
    prisma.client.findFirst({
      where: { psychologistId, isDemo: true, deletedAt: null },
      select: { id: true, createdAt: true },
    }),
  ]);
  const completedDemoSessions = demoClient
    ? await prisma.session.findMany({
        where: { psychologistId, clientId: demoClient.id, status: 'COMPLETED' },
        select: { scheduledAt: true },
      })
    : [];

  const journey = buildFirstRunJourney({
    hasExampleClient: demoClient !== null,
    hasRealClient: realClients > 0,
    hasCompletedRoleplay:
      demoClient !== null &&
      hasCompletedRoleplaySession(
        demoClient.createdAt,
        completedDemoSessions.map(({ scheduledAt }) => scheduledAt),
      ),
    hasCompletedRealSession: realSessions > 0,
    hasReviewedRealNote: reviewedNotes > 0,
  });
  if (journey.complete) return null;

  return (
    <Card className="mt-6 border-[var(--color-accent)]/30 p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-accent)]">
        Choose how to start
      </p>
      <h2 className="mt-1 font-serif text-2xl">Get value before your first busy day</h2>
      <p className="mt-1 text-sm text-[var(--color-ink-2)]">
        Pick one path now. You can try the others whenever you like.
      </p>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        {journey.choices.map((choice) => (
          <div
            key={choice.id}
            className="flex flex-col rounded-2xl border border-[var(--color-line)] bg-white p-4"
          >
            <p className="font-medium text-[var(--color-ink)]">
              {choice.done ? '✓ ' : ''}
              {choice.label}
            </p>
            <p className="mt-1 flex-1 text-xs text-[var(--color-ink-3)]">{choice.description}</p>
            {choice.id === 'example' ? (
              <div className="mt-4">
                <DemoClientButton demoClientId={demoClient?.id ?? null} variant="cta" />
              </div>
            ) : choice.id === 'roleplay' && !demoClient ? (
              <div className="mt-4">
                <DemoClientButton demoClientId={null} variant="cta" />
              </div>
            ) : (
              <Link
                href={
                  choice.id === 'roleplay' && demoClient && !choice.done
                    ? `/app/encounters/new?record=${demoClient.id}&roleplay=1`
                    : choice.href
                }
                className="mt-4 text-xs font-semibold text-[var(--color-accent)] hover:underline"
              >
                {choice.ctaLabel} →
              </Link>
            )}
          </div>
        ))}
      </div>

      <div className="mt-6 border-t border-[var(--color-line-soft)] pt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-3)]">
          Your first real workflow
        </p>
        <ul className="mt-2 space-y-2">
          {journey.steps.map((step) => (
            <li
              key={step.id}
              className="flex items-center gap-3 rounded-xl bg-white px-4 py-3 text-sm"
            >
              <span aria-hidden>{step.done ? '✓' : '○'}</span>
              <div className="min-w-0 flex-1">
                <p className={step.done ? 'text-[var(--color-ink-3)] line-through' : 'font-medium'}>
                  {step.label}
                </p>
                <p className="text-xs text-[var(--color-ink-3)]">{step.description}</p>
              </div>
              {!step.done ? (
                <Link
                  href={step.href}
                  className="shrink-0 text-xs font-semibold text-[var(--color-accent)] hover:underline"
                >
                  {step.ctaLabel} →
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
