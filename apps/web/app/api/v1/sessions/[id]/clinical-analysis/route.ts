import { NextResponse, type NextRequest } from 'next/server';
import type { ClinicalLocale } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { runClinicalAnalysis } from '@/lib/note-orchestrator';
import { prisma } from '@/lib/prisma';
import { readInitialAssessmentBrief, toClinicalReport } from '@/lib/clinical-mappers';

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
  const auth = await requirePsychologistId(req);
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
          transcript: true,
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
  if (!draft || draft.status !== 'COMPLETED' || !draft.transcript || !draft.content) {
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

  const segments = draft.speakerSegments as
    | {
        speaker: 'therapist' | 'client' | 'unknown';
        startMs: number;
        endMs: number;
        text: string;
      }[]
    | null;
  if (!segments || segments.length === 0) {
    return NextResponse.json(
      { error: 'No speaker segments available — Pass 1 output is incomplete.' },
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
    transcript: draft.transcript,
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
 * GET /api/v1/sessions/[id]/clinical-analysis — read the current
 * report (or 404 if none exists yet).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await params;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true, psychologistId: true },
  });
  if (!session || session.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  const row = await prisma.clinicalReport.findUnique({ where: { sessionId } });
  if (!row) {
    return NextResponse.json(
      { error: 'No clinical report for this session yet.' },
      { status: 404 },
    );
  }
  return NextResponse.json({
    report: toClinicalReport(row),
    initialAssessmentBrief: readInitialAssessmentBrief(row),
  });
}
