import type { SessionStatus } from '@prisma/client';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type {
  NoteDraft,
  SessionKind,
  SpeakerSegment,
  TherapyNote,
  TherapyNoteV1,
} from '@cureocity/contracts';
import { Container } from '@/components/ui/Container';
import { AICopilotTab } from '@/components/app/AICopilotTab';
import { MindmapTab } from '@/components/app/MindmapTab';
import { NotesTab } from '@/components/app/NotesTab';
import { MindSessionCloseout } from '@/components/app/MindSessionCloseout';
import { MindSessionReviewHeader } from '@/components/app/MindSessionReviewHeader';
import { selectedQuestionsForSession } from '@/components/app/MindSessionCloseoutEvidence';
import styles from '@/components/app/MindSessionReview.module.css';
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
import { formatIstDateTime } from '@/lib/ist';
import { languageNames } from '@/lib/language-names';
import { prisma } from '@/lib/prisma';
import { toNoteDraft } from '@/lib/mappers';
import { resolveNoteTranscript } from '@/lib/note-transcript';
import { deriveMindSessionCloseout } from '@/lib/mind-session-closeout';
import { getEffectiveCapabilities } from '@/lib/capabilities';
import { canOpenMindPage, loadOptionalCapabilityData } from '@/lib/mind-page-capabilities';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; sub?: string }>;
}

const VALID_TABS: ReadonlySet<TabKey> = new Set(['review', 'note', 'transcript', 'details']);

function parseTab(raw: string | undefined): TabKey {
  if (!raw) return 'note';
  if ((VALID_TABS as ReadonlySet<string>).has(raw)) return raw as TabKey;
  if (raw === 'notes' || raw === 'reflection') return 'note';
  if (raw === 'session-info') return 'details';
  if (raw === 'mindmap') return 'transcript';
  return 'note';
}

export default async function SessionPage({ params, searchParams }: PageProps) {
  // SECURITY (Sprint 78): this page renders the transcript, note, and client
  // PII — the most sensitive screen in the app. It MUST authenticate and
  // tenant-scope like every other data-bearing page (the /app layout does not
  // redirect). `findFirst` with psychologistId makes cross-tenant / unauth URL
  // probing return 404.
  const therapist = await requireOnboardedPsychologist();
  if (therapist.vertical === 'DOCTOR') redirect('/app/clinic');
  const effective = await getEffectiveCapabilities(therapist.id);
  if (!canOpenMindPage('session', effective.capabilities)) notFound();
  const canShare = effective.capabilities.has('PATIENT_SHARING');
  const canUseMeasures = effective.capabilities.has('MEASUREMENT_BASED_CARE');
  const canUseWorkflows = effective.capabilities.has('THERAPY_WORKFLOWS');

  const { id } = await params;
  const { tab: rawTab, sub: rawSub } = await searchParams;
  const tab = parseTab(rawTab);

  const session = await prisma.session.findFirst({
    where: { id, psychologistId: therapist.id },
    include: {
      client: {
        select: {
          fullNameEncrypted: true,
          preferredLanguage: true,
          preferredModality: true,
          contactPhoneEncrypted: true,
          contactEmailEncrypted: true,
          isDemo: true,
        },
      },
    },
  });
  if (!session) notFound();
  if (
    rawTab === 'plan-of-care' ||
    (rawTab === 'copilot' && ['plan', 'formulation'].includes(rawSub ?? ''))
  ) {
    redirect(`/app/clients/${session.clientId}/plan`);
  }
  if (rawTab === 'client') redirect(`/app/clients/${session.clientId}`);
  if (rawTab === 'copilot' && rawSub === 'progress') {
    redirect(`/app/clients/${session.clientId}/journey`);
  }
  if (rawTab === 'copilot' && ['journey', 'measures', 'briefing'].includes(rawSub ?? '')) {
    redirect(`/app/clients/${session.clientId}/journey`);
  }
  if (rawTab === 'copilot' && (!rawSub || ['session', 'review'].includes(rawSub))) {
    redirect(`/app/sessions/${id}?tab=review`);
  }
  if (rawTab === 'copilot' && rawSub === 'close') {
    redirect(`/app/sessions/${id}?tab=note`);
  }
  if (rawTab === 'clinical-brief') redirect(`/app/sessions/${id}?tab=review`);
  if (rawTab === 'notes' || rawTab === 'reflection') {
    redirect(`/app/sessions/${id}?tab=note`);
  }
  if (rawTab === 'session-info') redirect(`/app/sessions/${id}?tab=details`);
  if (rawTab === 'mindmap') redirect(`/app/sessions/${id}?tab=transcript`);

  const pii = await resolveClientPii({ ...session.client, psychologistId: session.psychologistId });

  const sessionKind: SessionKind = session.kind;

  // Sprint 73 — case thread: where this document sits in the client's
  // arc + what carried over. Defensive: a compose failure must never
  // break the page (the note itself is the point), so we fall back to null.
  const caseThread: CaseThread | null = await computeCaseThread(id, session.psychologistId, {
    includeMeasures: canUseMeasures,
    includeWorkflows: canUseWorkflows,
  }).catch((e) => {
    if (e instanceof CaseThreadError) return null;
    throw e;
  });

  return (
    <Container className="py-8">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href={`/app/clients/${session.clientId}`}
          className="text-sm text-[var(--color-ink-3)] hover:text-[var(--color-ink)]"
        >
          ← Back to {pii.fullName}
        </Link>
        {caseThread && <CaseThreadNav position={caseThread.position} />}
      </div>

      <MindSessionReviewHeader
        clientName={pii.fullName}
        sessionDate={formatIstDateTime(session.scheduledAt)}
        sessionKind={sessionKind}
        status={session.status}
        isDemo={session.client.isDemo}
        spokenLanguageLabel={languageNames(session.spokenLanguages)}
      />

      <div className="print:hidden">
        <SessionWorkspaceTabs sessionId={id} active={tab} sessionKind={sessionKind} />
      </div>

      <div className="mt-6">
        {tab === 'note' && (
          <NotesTabPanel
            sessionId={id}
            psychologistId={session.psychologistId}
            sessionStatus={session.status}
            sessionKind={sessionKind}
            clientId={session.clientId}
            clientHasContactPhone={!!pii.contactPhone}
            clientHasContactEmail={!!pii.contactEmail}
            clientName={pii.fullName}
            clientPreferredModality={session.client.preferredModality}
            sessionAt={session.scheduledAt}
            noteLanguage={session.language}
            clientPreferredLanguage={session.client.preferredLanguage}
            noteTemplateId={session.noteTemplateId}
            caseThread={caseThread}
            signerName={therapist.fullName}
            canShare={canShare}
            canUseWorkflows={canUseWorkflows}
          />
        )}
        {tab === 'review' && (
          <section>
            <div className={styles.sectionIntro}>
              <div>
                <h2>Clinical context</h2>
                <p>
                  Review the evidence, keep useful suggestions and choose what carries into the next
                  session.
                </p>
              </div>
              <Link className={styles.contextLink} href={`/app/sessions/${id}?tab=note`}>
                Return to your note
              </Link>
            </div>
            <AICopilotTab
              sessionId={id}
              clientId={session.clientId}
              psychologistId={session.psychologistId}
              clientName={pii.fullName}
              clientHasContactPhone={!!pii.contactPhone}
              clientHasContactEmail={!!pii.contactEmail}
              preferredLanguage={session.client.preferredLanguage}
              sessionKind={sessionKind}
              sub="session"
              showSubTabs={false}
              canUseMeasures={canUseMeasures}
              canShare={canShare}
            />
          </section>
        )}
        {tab === 'transcript' && (
          <TranscriptTabPanel sessionId={id} psychologistId={therapist.id} />
        )}
        {tab === 'details' && <SessionInfoTabPanel sessionId={id} />}
      </div>
    </Container>
  );
}

async function NotesTabPanel({
  sessionId,
  psychologistId,
  sessionStatus,
  sessionKind,
  clientId,
  clientHasContactPhone,
  clientHasContactEmail,
  clientName,
  clientPreferredModality,
  sessionAt,
  noteLanguage,
  clientPreferredLanguage,
  noteTemplateId,
  caseThread,
  signerName,
  canShare,
  canUseWorkflows,
}: {
  sessionId: string;
  psychologistId: string;
  sessionStatus: SessionStatus;
  sessionKind: SessionKind;
  clientId: string;
  clientHasContactPhone: boolean;
  clientHasContactEmail: boolean;
  clientName: string;
  clientPreferredModality: string | null;
  sessionAt: Date;
  noteLanguage: string;
  clientPreferredLanguage: string;
  noteTemplateId: string | null;
  caseThread: CaseThread | null;
  signerName: string;
  canShare: boolean;
  canUseWorkflows: boolean;
}) {
  const [draftRow, signedRow, closeoutState, agreementCount, clientQuestionState, shareRows] =
    await Promise.all([
      prisma.noteDraft.findUnique({ where: { sessionId } }),
      prisma.therapyNote.findUnique({
        where: { sessionId },
        include: { edits: { orderBy: { createdAt: 'asc' } } },
      }),
      prisma.mindSessionCloseoutState.findUnique({ where: { sessionId } }),
      prisma.sessionAgreement.count({ where: { sessionId } }),
      prisma.client.findFirst({
        where: { id: clientId, psychologistId },
        select: { carriedQuestions: true },
      }),
      loadOptionalCapabilityData(
        canShare ? new Set(['PATIENT_SHARING'] as const) : new Set(),
        'PATIENT_SHARING',
        () =>
          prisma.patientShare.findMany({
            where: { sessionId, psychologistId },
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              subject: true,
              artefactType: true,
              channel: true,
              status: true,
              createdAt: true,
              sentAt: true,
              openedAt: true,
              revokedAt: true,
              expiresAt: true,
              refreshRequestedAt: true,
              errorCode: true,
              verifiedNonDeliveryAt: true,
            },
          }),
        [],
      ),
    ]);

  const draft: NoteDraft | null = draftRow
    ? toNoteDraft(draftRow, await resolveNoteTranscript(psychologistId, draftRow))
    : null;
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

  const selectedQuestions = selectedQuestionsForSession(
    clientQuestionState?.carriedQuestions,
    sessionId,
  );
  const closeout = deriveMindSessionCloseout({
    draftStatus: draftRow?.status ?? null,
    noteSigned: signedRow?.locked === true,
    suggestionsResolved: closeoutState?.clinicalSuggestionsResolvedAt != null,
    suggestionsSkipped: closeoutState?.clinicalSuggestionsSkippedAt != null,
    agreementsCaptured: agreementCount > 0,
    agreementsSkipped: closeoutState?.agreementsSkippedAt != null,
    nextQuestionsSelected: selectedQuestions.length > 0,
    nextQuestionsSkipped: closeoutState?.nextQuestionsSkippedAt != null,
    shared: shareRows.some((share) => share.status === 'SENT' || share.status === 'OPENED'),
    shareSkipped: closeoutState?.shareSkippedAt != null,
    followUpScheduled: closeoutState?.followUpSessionId != null,
    followUpSkipped: closeoutState?.followUpSkippedAt != null,
    legacySession: closeoutState?.legacyImported === true,
  });

  return (
    <MindSessionCloseout
      sessionId={sessionId}
      closeout={closeout}
      client={{ id: clientId, fullName: clientName, preferredModality: clientPreferredModality }}
      sessionAt={sessionAt}
      sessionCompleted={sessionStatus === 'COMPLETED'}
      canShare={canShare}
      agreementCount={agreementCount}
      selectedQuestionCount={selectedQuestions.length}
      receipts={shareRows.map((share) => ({
        ...share,
        createdAt: share.createdAt.toISOString(),
        sentAt: share.sentAt?.toISOString() ?? null,
        openedAt: share.openedAt?.toISOString() ?? null,
        revokedAt: share.revokedAt?.toISOString() ?? null,
        verifiedNonDeliveryAt: share.verifiedNonDeliveryAt?.toISOString() ?? null,
        expiresAt: share.expiresAt.toISOString(),
        refreshRequestedAt: share.refreshRequestedAt?.toISOString() ?? null,
      }))}
    >
      <div className="space-y-6">
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
          signerName={signerName}
          canShare={canShare}
          focusedReview
        />
        {caseThread && (
          <details className={styles.disclosure}>
            <summary>Previous session, measures and focus areas</summary>
            <div className={`${styles.disclosureBody} space-y-5`}>
              <WhereWeLeftOff thread={caseThread} currentKind={sessionKind} />
              {caseThread.measures.length > 0 && <MeasuresTrend measures={caseThread.measures} />}
              {canUseWorkflows && (
                <SessionProblemTags
                  sessionId={sessionId}
                  active={caseThread.sessionProblems.active}
                  initialTaggedIds={caseThread.sessionProblems.taggedIds}
                />
              )}
            </div>
          </details>
        )}
      </div>
    </MindSessionCloseout>
  );
}

async function TranscriptTabPanel({
  sessionId,
  psychologistId,
}: {
  sessionId: string;
  psychologistId: string;
}) {
  const [draftRow, signedRow, lastCall] = await Promise.all([
    prisma.noteDraft.findUnique({
      where: { sessionId },
      select: {
        status: true,
        transcriptEncrypted: true,
        speakerSegments: true,
        totalCostInr: true,
        errorMessage: true,
        content: true,
      },
    }),
    prisma.therapyNote.findUnique({ where: { sessionId }, select: { content: true } }),
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
  // Mindmap moved here (R1) — it's a view OF the note, so it belongs beside
  // the transcript, not in the copilot decision flow.
  const noteJson = (signedRow?.content ?? draftRow.content ?? null) as TherapyNoteV1 | null;

  return (
    <div className="space-y-6">
      <TranscriptTab
        data={{
          status: draftRow.status,
          segments,
          transcript: await resolveNoteTranscript(psychologistId, draftRow),
          totalCostInr: draftRow.totalCostInr.toString(),
          backend: lastCall ? `${lastCall.model} (${lastCall.region})` : null,
          errorMessage: draftRow.errorMessage,
        }}
      />
      {noteJson && (
        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-3)]">
            Session mindmap
          </h3>
          <MindmapTab note={noteJson} />
        </section>
      )}
    </div>
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
