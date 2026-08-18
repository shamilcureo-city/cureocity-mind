import { NextResponse, type NextRequest } from 'next/server';
import type { ClinicalLocale } from '@cureocity/contracts';
import { requireCapability } from '@/lib/auth-server';
import { runClinicalAnalysis } from '@/lib/note-orchestrator';
import { prisma } from '@/lib/prisma';
import { readInitialAssessmentBrief, toClinicalReport } from '@/lib/clinical-mappers';
import { coverTranscriptWithSegments } from '@/lib/transcribe-segment';
import { hasTranscript, resolveNoteTranscript } from '@/lib/note-transcript';

type SpeakerSegmentRow = {
  speaker: 'therapist' | 'client' | 'unknown';
  startMs: number;
  endMs: number;
  text: string;
};

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * POST /api/v1/sessions/[id]/clinical-analysis — manually (re)run Pass 3
 * Clinical Analysis on a session. Used when:
 *   - The orchestrator's inline run failed (errorMessage on the row)
 *   - The therapist updated the underlying note and wants the brief
 *     refreshed
 *
 * Idempotent in spirit; the cumulative ClientDiagnosis + TreatmentPlan
 * rows are NOT affected — only the ClinicalReport.body + status. Per-
 * section confirmations are preserved across re-runs so the therapist
 * doesn't lose accept/reject decisions.
 *
 * Returns the updated ClinicalReport (potentially still PENDING if
 * Pass 3 is async; in the current inline implementation it will be
 * COMPLETED or FAILED by the time this returns).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireCapability(req, 'CLINICAL_ANALYSIS');
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await params;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      psychologistId: true,
      clientId: true,
      modality: true,
      kind: true,
      language: true,
      client: { select: { presentingConcerns: true } },
      noteDraft: {
        select: {
          status: true,
          transcriptEncrypted: true,
          speakerSegments: true,
          content: true,
          errorMessage: true,
        },
      },
    },
  });
  if (!session || session.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  const draft = session.noteDraft;
  if (!draft || draft.status !== 'COMPLETED' || !hasTranscript(draft) || !draft.content) {
    // Sprint 56 hotfix — when Pass 1 returned an empty transcript the
    // draft is FAILED with an actionable errorMessage. Surface that
    // instead of the generic "must be COMPLETED first" so the UI can
    // route the user to /generate-note (which Pass 1-retries) instead
    // of looping on /clinical-analysis (which will keep 409-ing until
    // the underlying note succeeds).
    const code =
      !draft || draft.status === 'PENDING' || draft.status === 'IN_PROGRESS'
        ? 'NOTE_NOT_READY'
        : 'NOTE_NOT_USABLE';
    return NextResponse.json(
      {
        error:
          code === 'NOTE_NOT_READY'
            ? 'The note is still generating. Wait a moment and retry.'
            : (draft?.errorMessage ??
              'The transcript came back empty, so no clinical analysis can run on this session. Re-record or hit Retry on the Note tab to re-run transcription.'),
        code,
      },
      { status: 409 },
    );
  }

  const transcript = (await resolveNoteTranscript(session.psychologistId, draft)) ?? '';

  // A draft can hold a full transcript and an EMPTY speaker timeline when Pass 1
  // transcribed a window but didn't diarize it. That used to hard-409 here, which
  // left the therapist with a finished note and a permanently dead AI copilot —
  // and no way out, because re-running hit the same wall. runOrAssemblePass1 now
  // guarantees coverage for new sessions; this heals the ones already stored,
  // labelling the text `unknown` rather than guessing who spoke.
  const stored = draft.speakerSegments as SpeakerSegmentRow[] | null;
  let segments = stored ?? [];
  if (segments.length === 0) {
    const chunks = await prisma.audioChunk.aggregate({
      where: { sessionId },
      _sum: { durationMs: true },
    });
    segments = coverTranscriptWithSegments({
      transcript,
      segments: [],
      startMs: 0,
      endMs: chunks._sum.durationMs ?? 0,
    }) as SpeakerSegmentRow[];
  }
  if (segments.length === 0) {
    return NextResponse.json(
      {
        error:
          'This session has no transcript to analyse. Re-run the note from the Note tab first.',
        code: 'NOTE_NOT_USABLE',
      },
      { status: 409 },
    );
  }

  await runClinicalAnalysis({
    sessionId: session.id,
    clientId: session.clientId,
    psychologistId: session.psychologistId,
    language: (session.language as ClinicalLocale | undefined) ?? 'en',
    kind: session.kind,
    modality: session.modality,
    presentingConcerns: session.client.presentingConcerns,
    transcript,
    speakerSegments: segments,
    note: draft.content as Parameters<typeof runClinicalAnalysis>[0]['note'],
  });

  const row = await prisma.clinicalReport.findUnique({ where: { sessionId } });
  if (!row) {
    return NextResponse.json({ error: 'Clinical report row missing after run' }, { status: 500 });
  }
  // Sprint 19 — INTAKE sessions store an InitialAssessmentBriefV1 in
  // .body; toClinicalReport parses that column as ClinicalReportV1 so
  // it comes back null. Return the intake-shaped parse alongside so
  // the client can pick the right field by session.kind.
  return NextResponse.json({
    report: toClinicalReport(row),
    initialAssessmentBrief: readInitialAssessmentBrief(row),
  });
}

/**
 * GET /api/v1/sessions/[id]/clinical-analysis — read the current report,
 * plus where the pipeline stands (`sessionStatus` + `noteStatus`). The
 * copilot board polls this from the moment the therapist lands after a
 * recording; before the report row exists it needs "not yet" (keep
 * waiting, here's what's running) rather than a bare 404.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireCapability(req, 'CLINICAL_ANALYSIS');
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await params;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      psychologistId: true,
      status: true,
      noteDraft: { select: { status: true } },
    },
  });
  if (!session || session.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  const progress = {
    sessionStatus: session.status,
    noteStatus: session.noteDraft?.status ?? null,
  };
  const row = await prisma.clinicalReport.findUnique({ where: { sessionId } });
  if (!row) {
    return NextResponse.json({ report: null, initialAssessmentBrief: null, ...progress });
  }
  return NextResponse.json({
    report: toClinicalReport(row),
    initialAssessmentBrief: readInitialAssessmentBrief(row),
    ...progress,
  });
}
