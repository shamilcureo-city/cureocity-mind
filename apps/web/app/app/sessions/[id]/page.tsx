import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { NoteDraft, TherapyNote, TherapyNoteV1 } from '@cureocity/contracts';
import { Container } from '@/components/ui/Container';
import { Badge } from '@/components/ui/Badge';
import { SessionWorkspaceTabs } from '@/components/app/SessionWorkspaceTabs';
import { NotesTab } from '@/components/app/NotesTab';
import { prisma } from '@/lib/prisma';
import { toNoteDraft } from '@/lib/mappers';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function SessionPage({ params }: PageProps) {
  const { id } = await params;
  const session = await prisma.session.findUnique({
    where: { id },
    include: { client: { select: { fullName: true } } },
  });
  if (!session) notFound();

  const [draftRow, signedRow] = await Promise.all([
    prisma.noteDraft.findUnique({ where: { sessionId: id } }),
    prisma.therapyNote.findUnique({
      where: { sessionId: id },
      include: { edits: { orderBy: { createdAt: 'asc' } } },
    }),
  ]);

  const draft: NoteDraft | null = draftRow ? toNoteDraft(draftRow) : null;
  const signedNote: TherapyNote | null = signedRow
    ? {
        id: signedRow.id,
        sessionId: signedRow.sessionId,
        draftId: signedRow.draftId,
        version: 'V1',
        content: signedRow.content as unknown as TherapyNoteV1,
        signedAt: signedRow.signedAt.toISOString(),
        signedBy: signedRow.signedBy,
        edits: signedRow.edits.map((e) => ({
          id: e.id,
          field: e.field,
          before: e.before,
          after: e.after,
          createdAt: e.createdAt.toISOString(),
        })),
        signCredentialId: signedRow.signCredentialId,
        signChallengeHashHex: signedRow.signChallengeHashHex,
        createdAt: signedRow.createdAt.toISOString(),
      }
    : null;

  return (
    <Container className="py-8">
      <Link
        href="/app"
        className="text-sm text-[var(--color-ink-3)] hover:text-[var(--color-ink)]"
      >
        ← All sessions
      </Link>

      <header className="mt-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl">{session.client.fullName}</h1>
          <p className="mt-1 text-sm text-[var(--color-ink-2)]">
            {session.modality} · {session.scheduledAt.toLocaleString('en-US')}
          </p>
        </div>
        <Badge tone={statusTone(session.status)}>
          {session.status.replace(/_/g, ' ').toLowerCase()}
        </Badge>
      </header>

      <div className="mt-8">
        <SessionWorkspaceTabs active="notes" />
      </div>

      <div className="mt-6">
        <NotesTab
          sessionId={id}
          sessionStatus={session.status}
          initialDraft={draft}
          initialNote={signedNote}
        />
      </div>
    </Container>
  );
}

function statusTone(status: string): 'accent' | 'warn' | 'muted' | 'default' {
  if (status === 'COMPLETED') return 'accent';
  if (status === 'IN_PROGRESS') return 'warn';
  if (status === 'CANCELLED' || status === 'NO_SHOW') return 'muted';
  return 'default';
}
