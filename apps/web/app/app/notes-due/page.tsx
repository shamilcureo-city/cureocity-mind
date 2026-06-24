import Link from 'next/link';
import { Container } from '@/components/ui/Container';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { HelpNote } from '@/components/app/EduHeading';
import { requireOnboardedPsychologist } from '@/lib/auth-page';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * Sprint 67b — the documentation worklist ("notes to finish").
 *
 * Every completed session across the caseload that doesn't yet have a
 * signed note, in one list — so end-of-day documentation is a single
 * worklist rather than a hunt client by client. Read-only; the actual
 * generate/sign happens on each session (sign-off is WebAuthn-bound and
 * deliberately not batched here).
 */

type Bucket = 'TO_SIGN' | 'TO_GENERATE' | 'GENERATING' | 'FAILED';

const BUCKET: Record<Bucket, { label: string; hint: string; tone: 'accent' | 'muted' | 'warn' }> = {
  TO_SIGN: { label: 'Ready to sign', hint: 'Draft is ready — review and sign.', tone: 'accent' },
  TO_GENERATE: {
    label: 'Note not started',
    hint: 'Open the session and generate the note.',
    tone: 'muted',
  },
  GENERATING: { label: 'Writing…', hint: 'The note is still being written.', tone: 'muted' },
  FAILED: {
    label: 'Needs a retry',
    hint: 'Note generation failed — open and retry.',
    tone: 'warn',
  },
};

const ORDER: Bucket[] = ['TO_SIGN', 'FAILED', 'TO_GENERATE', 'GENERATING'];

function bucketFor(draftStatus: string | null | undefined): Bucket {
  if (draftStatus === 'COMPLETED') return 'TO_SIGN';
  if (draftStatus === 'FAILED') return 'FAILED';
  if (draftStatus === 'PENDING' || draftStatus === 'IN_PROGRESS') return 'GENERATING';
  return 'TO_GENERATE';
}

export default async function NotesDuePage() {
  const therapist = await requireOnboardedPsychologist();

  const sessions = await prisma.session.findMany({
    where: {
      psychologistId: therapist.id,
      status: 'COMPLETED',
      therapyNote: { is: null },
      client: { deletedAt: null },
    },
    orderBy: { scheduledAt: 'desc' },
    take: 100,
    select: {
      id: true,
      scheduledAt: true,
      kind: true,
      client: { select: { fullName: true } },
      noteDraft: { select: { status: true } },
    },
  });

  const rows = sessions.map((s) => ({
    id: s.id,
    clientName: s.client.fullName,
    scheduledAt: s.scheduledAt,
    kind: s.kind,
    bucket: bucketFor(s.noteDraft?.status),
  }));

  const grouped = ORDER.map((b) => ({
    bucket: b,
    rows: rows.filter((r) => r.bucket === b),
  })).filter((g) => g.rows.length > 0);

  return (
    <Container className="py-10">
      <header className="mb-6">
        <h1 className="font-serif text-3xl">Notes to finish</h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--color-ink-2)]">
          Every completed session that still needs a note, in one place. Tick through them at the
          end of the day.
        </p>
      </header>

      {rows.length === 0 ? (
        <HelpNote title="You're all caught up">
          Every completed session has a signed note. Nothing to finish right now.
        </HelpNote>
      ) : (
        <div className="space-y-8">
          {grouped.map((g) => (
            <section key={g.bucket}>
              <div className="mb-3 flex items-center gap-2">
                <h2 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
                  {BUCKET[g.bucket].label}
                </h2>
                <Badge tone={BUCKET[g.bucket].tone}>{g.rows.length}</Badge>
              </div>
              <Card className="overflow-hidden">
                <ul className="divide-y divide-[var(--color-line-soft)]">
                  {g.rows.map((r) => (
                    <li key={r.id}>
                      <Link
                        href={`/app/sessions/${r.id}`}
                        className="flex items-center justify-between gap-3 px-5 py-4 text-sm transition-colors hover:bg-[var(--color-surface-soft)]"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium text-[var(--color-ink)]">
                            {r.clientName}
                          </p>
                          <p className="truncate text-xs text-[var(--color-ink-3)]">
                            {r.kind.toLowerCase()} ·{' '}
                            {r.scheduledAt.toLocaleDateString('en-IN', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                            })}{' '}
                            · {BUCKET[r.bucket].hint}
                          </p>
                        </div>
                        <span aria-hidden className="text-[var(--color-ink-3)]">
                          →
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          ))}
        </div>
      )}
    </Container>
  );
}
