import type { SessionStatus } from '@prisma/client';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type {
  NoteDraft,
  SessionKind,
  SpeakerSegment,
  TherapyNote,
  TherapyNoteV1,
} from '@cureocity/contracts';
import { Container } from '@/components/ui/Container';
import { Badge } from '@/components/ui/Badge';
import { AICopilotTab } from '@/components/app/AICopilotTab';
import { ClientTab } from '@/components/app/ClientTab';
import { NotesTab } from '@/components/app/NotesTab';
import { SessionInfoTab } from '@/components/app/SessionInfoTab';
import { SessionWorkspaceTabs, type TabKey } from '@/components/app/SessionWorkspaceTabs';
import { TranscriptTab } from '@/components/app/TranscriptTab';
import { prisma } from '@/lib/prisma';
import { toNoteDraft } from '@/lib/mappers';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}

const VALID_TABS: ReadonlySet<TabKey> = new Set([
  'notes',
  'copilot',
  'transcript',
  'session-info',
  'client',
]);

/**
 * Sprint 27 — top-level tab parser.
 *
 * Accepts the 5-key bar (notes / copilot / transcript / session-info
 * / client). Legacy keys (clinical-brief, mindmap, reflection) fold
 * to the per-session AI Copilot so old bookmarks keep working.
 */
function parseTab(raw: string | undefined): TabKey {
  if (!raw) return 'notes';
  if ((VALID_TABS as ReadonlySet<string>).has(raw)) {
    return raw as TabKey;
  }
  if (raw === 'clinical-brief' || raw === 'mindmap' || raw === 'reflection') {
    return 'copilot';
  }
  return 'notes';
}

export default async function SessionPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { tab: rawTab } = await searchParams;
  const tab = parseTab(rawTab);

  const session = await prisma.session.findUnique({
    where: { id },
    include: { client: { select: { fullName: true } } },
  });
  if (!session) notFound();

  const sessionKind: SessionKind = session.kind;
  const isIntake = sessionKind === 'INTAKE';

  return (
    <Container className="py-8">
      <Link href="/app" className="text-sm text-[var(--color-ink-3)] hover:text-[var(--color-ink)]">
        ← All sessions
      </Link>

      <header className="mt-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl">{session.client.fullName}</h1>
          <p className="mt-1 text-sm text-[var(--color-ink-2)]">
            {session.modality ?? session.kind} · {session.scheduledAt.toLocaleString('en-US')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isIntake && <Badge tone="accent">intake session</Badge>}
          {session.spokenLanguages.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-surface)] px-3 py-1 text-xs text-[var(--color-ink-2)]">
              spoken: {session.spokenLanguages.join(' + ')}
            </span>
          )}
          <Badge tone={statusTone(session.status)}>
            {session.status.replace(/_/g, ' ').toLowerCase()}
          </Badge>
        </div>
      </header>

      <div className="mt-8">
        <SessionWorkspaceTabs sessionId={id} active={tab} sessionKind={sessionKind} />
      </div>

      <div className="mt-6">
        {tab === 'notes' && (
          <NotesTabPanel
            sessionId={id}
            sessionStatus={session.status}
            sessionKind={sessionKind}
            clientId={session.clientId}
          />
        )}
        {tab === 'copilot' && (
          <AICopilotTab sessionId={id} clientId={session.clientId} sessionKind={sessionKind} />
        )}
        {tab === 'client' && <ClientTabPanel clientId={session.clientId} sessionId={id} />}
        {tab === 'transcript' && <TranscriptTabPanel sessionId={id} />}
        {tab === 'session-info' && <SessionInfoTabPanel sessionId={id} />}
      </div>
    </Container>
  );
}

async function NotesTabPanel({
  sessionId,
  sessionStatus,
  sessionKind,
  clientId,
}: {
  sessionId: string;
  sessionStatus: SessionStatus;
  sessionKind: SessionKind;
  clientId: string;
}) {
  const [draftRow, signedRow] = await Promise.all([
    prisma.noteDraft.findUnique({ where: { sessionId } }),
    prisma.therapyNote.findUnique({
      where: { sessionId },
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
    <NotesTab
      sessionId={sessionId}
      sessionStatus={sessionStatus}
      sessionKind={sessionKind}
      initialDraft={draft}
      initialNote={signedNote}
      clientId={clientId}
      llmBackend={process.env['LLM_BACKEND'] ?? 'mock'}
    />
  );
}

async function ClientTabPanel({ clientId, sessionId }: { clientId: string; sessionId: string }) {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: {
      fullName: true,
      contactPhone: true,
      contactEmail: true,
      dateOfBirth: true,
      presentingConcerns: true,
      preferredModality: true,
    },
  });
  if (!client) {
    return <p className="text-sm text-[var(--color-ink-2)]">Client record not found.</p>;
  }

  const [pastSessionCount, lastSession] = await Promise.all([
    prisma.session.count({
      where: {
        clientId,
        status: 'COMPLETED',
        id: { not: sessionId },
      },
    }),
    prisma.session.findFirst({
      where: {
        clientId,
        status: 'COMPLETED',
        id: { not: sessionId },
      },
      orderBy: { scheduledAt: 'desc' },
      select: { scheduledAt: true },
    }),
  ]);

  return (
    <ClientTab
      data={{
        id: clientId,
        fullName: client.fullName,
        contactPhone: client.contactPhone,
        contactEmail: client.contactEmail,
        dateOfBirth: client.dateOfBirth,
        presentingConcerns: client.presentingConcerns,
        preferredModality: client.preferredModality,
        pastSessionCount,
        lastSessionAt: lastSession?.scheduledAt ?? null,
      }}
    />
  );
}

async function TranscriptTabPanel({ sessionId }: { sessionId: string }) {
  const [draftRow, lastCall] = await Promise.all([
    prisma.noteDraft.findUnique({
      where: { sessionId },
      select: {
        status: true,
        transcript: true,
        speakerSegments: true,
        totalCostInr: true,
        errorMessage: true,
      },
    }),
    prisma.geminiCallLog.findFirst({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
      select: { model: true, region: true },
    }),
  ]);

  if (!draftRow) {
    return (
      <p className="rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-6 text-sm text-[var(--color-ink-2)]">
        No note draft exists for this session yet. End the session from the Record screen to trigger
        note generation.
      </p>
    );
  }

  const segments = (draftRow.speakerSegments as SpeakerSegment[] | null) ?? null;

  return (
    <TranscriptTab
      data={{
        status: draftRow.status,
        segments,
        transcript: draftRow.transcript,
        totalCostInr: draftRow.totalCostInr.toString(),
        backend: lastCall ? `${lastCall.model} (${lastCall.region})` : null,
        errorMessage: draftRow.errorMessage,
      }}
    />
  );
}

async function SessionInfoTabPanel({ sessionId }: { sessionId: string }) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      modality: true,
      status: true,
      scheduledAt: true,
      startedAt: true,
      endedAt: true,
      createdAt: true,
      consentSnapshot: true,
    },
  });
  if (!session) return null;

  const [audioAgg, auditRows] = await Promise.all([
    prisma.audioChunk.aggregate({
      where: { sessionId },
      _count: { _all: true },
      _sum: { sizeBytes: true, durationMs: true },
    }),
    prisma.auditLog.findMany({
      where: {
        OR: [
          { targetType: 'Session', targetId: sessionId },
          { targetType: 'NoteDraft', metadata: { path: ['sessionId'], equals: sessionId } },
          { targetType: 'AudioChunk', metadata: { path: ['sessionId'], equals: sessionId } },
          { targetType: 'TherapyNote', metadata: { path: ['sessionId'], equals: sessionId } },
          { targetType: 'Consent', metadata: { path: ['sessionId'], equals: sessionId } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
      select: {
        id: true,
        action: true,
        actorType: true,
        createdAt: true,
        metadata: true,
      },
    }),
  ]);

  const consentSnapshot = Array.isArray(session.consentSnapshot)
    ? (session.consentSnapshot as Array<{ scope: string; scriptVersion: string; ackedAt: string }>)
    : [];

  return (
    <SessionInfoTab
      data={{
        id: session.id,
        modality: session.modality ?? 'INTAKE',
        status: session.status,
        scheduledAt: session.scheduledAt,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        createdAt: session.createdAt,
        consentSnapshot,
        audio: {
          chunkCount: audioAgg._count._all,
          totalSizeBytes: audioAgg._sum.sizeBytes ?? 0,
          totalDurationMs: audioAgg._sum.durationMs ?? 0,
        },
        auditTrail: auditRows.map((r) => ({
          id: r.id,
          action: r.action,
          actorType: r.actorType,
          createdAt: r.createdAt,
          metadata: r.metadata as Record<string, unknown> | null,
        })),
      }}
    />
  );
}

function statusTone(status: string): 'accent' | 'warn' | 'muted' | 'default' {
  if (status === 'COMPLETED') return 'accent';
  if (status === 'IN_PROGRESS') return 'warn';
  if (status === 'CANCELLED' || status === 'NO_SHOW') return 'muted';
  return 'default';
}
