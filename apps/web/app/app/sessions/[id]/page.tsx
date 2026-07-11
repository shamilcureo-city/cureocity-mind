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
import type { CopilotSubKey } from '@/components/app/AICopilotSubTabs';
import { ClientTab } from '@/components/app/ClientTab';
import { NotesTab } from '@/components/app/NotesTab';
import { SessionInfoTab } from '@/components/app/SessionInfoTab';
import { SessionWorkspaceTabs, type TabKey } from '@/components/app/SessionWorkspaceTabs';
import { TranscriptTab } from '@/components/app/TranscriptTab';
import { CaseThreadNav } from '@/components/app/CaseThreadNav';
import { WhereWeLeftOff } from '@/components/app/WhereWeLeftOff';
import { MeasuresTrend } from '@/components/app/MeasuresTrend';
import { SessionProblemTags } from '@/components/app/SessionProblemTags';
import { computeCaseThread, CaseThreadError, type CaseThread } from '@/lib/case-thread';
import { requireOnboardedPsychologist } from '@/lib/auth-page';
import { resolveClientPii } from '@/lib/client-pii';
import { prisma } from '@/lib/prisma';
import { toNoteDraft } from '@/lib/mappers';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; sub?: string }>;
}

const VALID_TABS: ReadonlySet<TabKey> = new Set([
  'notes',
  'copilot',
  'transcript',
  'session-info',
  'client',
]);

const VALID_SUBS: ReadonlySet<CopilotSubKey> = new Set(['session', 'journey', 'plan']);

// Sprint TSC-V2 — the five sub-tabs collapsed to three. Old links
// (measures/briefing fold into Journey; formulation into Plan & toolkit)
// keep working via this map.
const LEGACY_SUB_MAP: Record<string, CopilotSubKey> = {
  measures: 'journey',
  briefing: 'journey',
  formulation: 'plan',
};

/**
 * Sprint 28 — top-level tab parser.
 *
 * Accepts the 5-key bar (notes / copilot / transcript / session-info
 * / client). Legacy keys (clinical-brief, mindmap, reflection) fold
 * to the AI Copilot's "This session" sub-tab so old bookmarks keep
 * working.
 */
function parseTab(raw: string | undefined): { tab: TabKey; subOverride: CopilotSubKey | null } {
  if (!raw) return { tab: 'notes', subOverride: null };
  if ((VALID_TABS as ReadonlySet<string>).has(raw)) {
    return { tab: raw as TabKey, subOverride: null };
  }
  if (raw === 'clinical-brief' || raw === 'mindmap' || raw === 'reflection') {
    return { tab: 'copilot', subOverride: 'session' };
  }
  return { tab: 'notes', subOverride: null };
}

function parseSub(raw: string | undefined): CopilotSubKey {
  if (raw && (VALID_SUBS as ReadonlySet<string>).has(raw)) {
    return raw as CopilotSubKey;
  }
  if (raw && raw in LEGACY_SUB_MAP) return LEGACY_SUB_MAP[raw]!;
  return 'session';
}

export default async function SessionPage({ params, searchParams }: PageProps) {
  // SECURITY (Sprint 78): this page renders the transcript, note, and client
  // PII — the most sensitive screen in the app. It MUST authenticate and
  // tenant-scope like every other data-bearing page (the /app layout does not
  // redirect). `findFirst` with psychologistId makes cross-tenant / unauth URL
  // probing return 404.
  const therapist = await requireOnboardedPsychologist();

  const { id } = await params;
  const { tab: rawTab, sub: rawSub } = await searchParams;
  const { tab, subOverride } = parseTab(rawTab);
  const sub = subOverride ?? parseSub(rawSub);

  const session = await prisma.session.findFirst({
    where: { id, psychologistId: therapist.id },
    include: {
      client: {
        select: {
          fullNameEncrypted: true,
          preferredLanguage: true,
          contactPhoneEncrypted: true,
          contactEmailEncrypted: true,
          isDemo: true,
        },
      },
    },
  });
  if (!session) notFound();
  const pii = await resolveClientPii({ ...session.client, psychologistId: session.psychologistId });

  const sessionKind: SessionKind = session.kind;
  const isIntake = sessionKind === 'INTAKE';

  // Sprint 73 — case thread: where this document sits in the client's
  // arc + what carried over. Defensive: a compose failure must never
  // break the page (the note itself is the point), so we fall back to null.
  const caseThread: CaseThread | null = await computeCaseThread(id, session.psychologistId).catch(
    (e) => {
      if (e instanceof CaseThreadError) return null;
      throw e;
    },
  );

  return (
    <Container className="py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href={`/app/clients/${session.clientId}`}
          className="text-sm text-[var(--color-ink-3)] hover:text-[var(--color-ink)]"
        >
          ← Back to {pii.fullName}
        </Link>
        {caseThread && <CaseThreadNav position={caseThread.position} />}
      </div>

      <header className="mt-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex flex-wrap items-center gap-3 font-serif text-3xl">
            {pii.fullName}
            {session.client.isDemo && <Badge tone="warn">Example</Badge>}
          </h1>
          <p className="mt-1 text-sm text-[var(--color-ink-2)]">
            {session.modality ?? session.kind} · {session.scheduledAt.toLocaleString('en-IN')}
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
            clientHasContactPhone={!!pii.contactPhone}
            clientHasContactEmail={!!pii.contactEmail}
            clientName={pii.fullName}
            noteLanguage={session.language}
            clientPreferredLanguage={session.client.preferredLanguage}
            noteTemplateId={session.noteTemplateId}
            caseThread={caseThread}
          />
        )}
        {tab === 'copilot' && (
          <AICopilotTab
            sessionId={id}
            clientId={session.clientId}
            psychologistId={session.psychologistId}
            clientName={pii.fullName}
            clientHasContactPhone={!!pii.contactPhone}
            clientHasContactEmail={!!pii.contactEmail}
            preferredLanguage={session.client.preferredLanguage}
            sessionKind={sessionKind}
            sub={sub}
          />
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
  clientHasContactPhone,
  clientHasContactEmail,
  clientName,
  noteLanguage,
  clientPreferredLanguage,
  noteTemplateId,
  caseThread,
}: {
  sessionId: string;
  sessionStatus: SessionStatus;
  sessionKind: SessionKind;
  clientId: string;
  clientHasContactPhone: boolean;
  clientHasContactEmail: boolean;
  clientName: string;
  noteLanguage: string;
  clientPreferredLanguage: string;
  noteTemplateId: string | null;
  caseThread: CaseThread | null;
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
    <div className="space-y-6">
      {caseThread && <WhereWeLeftOff thread={caseThread} currentKind={sessionKind} />}
      {caseThread && caseThread.measures.length > 0 && (
        <MeasuresTrend measures={caseThread.measures} />
      )}
      {caseThread && (
        <SessionProblemTags
          sessionId={sessionId}
          active={caseThread.sessionProblems.active}
          initialTaggedIds={caseThread.sessionProblems.taggedIds}
        />
      )}
      <NotesTab
        sessionId={sessionId}
        sessionStatus={sessionStatus}
        sessionKind={sessionKind}
        initialDraft={draft}
        initialNote={signedNote}
        noteLocked={signedRow?.locked ?? true}
        clientId={clientId}
        clientHasContactPhone={clientHasContactPhone}
        clientHasContactEmail={clientHasContactEmail}
        llmBackend={process.env['LLM_BACKEND'] ?? 'mock'}
        clientName={clientName}
        noteLanguage={noteLanguage}
        clientPreferredLanguage={clientPreferredLanguage}
        noteTemplateId={noteTemplateId}
      />
    </div>
  );
}

async function ClientTabPanel({ clientId, sessionId }: { clientId: string; sessionId: string }) {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: {
      psychologistId: true,
      fullNameEncrypted: true,
      contactPhoneEncrypted: true,
      contactEmailEncrypted: true,
      dateOfBirth: true,
      presentingConcerns: true,
      preferredModality: true,
    },
  });
  if (!client) {
    return <p className="text-sm text-[var(--color-ink-2)]">Client record not found.</p>;
  }
  // PII read cutover — prefer the encrypted columns (plaintext fallback).
  const pii = await resolveClientPii(client);

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
        fullName: pii.fullName,
        contactPhone: pii.contactPhone,
        contactEmail: pii.contactEmail,
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
