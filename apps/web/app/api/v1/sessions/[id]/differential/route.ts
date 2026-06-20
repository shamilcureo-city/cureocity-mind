import { NextResponse, type NextRequest } from 'next/server';
import {
  DifferentialDiagnosisV1Schema,
  MedicalEncounterNoteV1Schema,
  type ClinicalLocale,
  type DifferentialResponse,
} from '@cureocity/contracts';
import type { Differential } from '@prisma/client';
import { requirePsychologistId } from '@/lib/auth-server';
import { runDifferential } from '@/lib/note-orchestrator';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Sprint DV6 — POST /api/v1/sessions/:id/differential
 *
 * (Re)run the differential-diagnosis pass for a doctor encounter. Needs a
 * COMPLETED medical note draft. Synchronous (own 120s budget); the
 * encounter panel triggers it once the note is ready. Tenant-checked.
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
      language: true,
      psychologist: { select: { specialty: true } },
      noteDraft: {
        select: { status: true, transcript: true, speakerSegments: true, content: true },
      },
    },
  });
  if (!session || session.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  const draft = session.noteDraft;
  if (!draft || draft.status !== 'COMPLETED' || !draft.transcript || !draft.content) {
    return NextResponse.json(
      {
        error: 'The encounter note is not ready yet. Generate the note first.',
        code: 'NOTE_NOT_READY',
      },
      { status: 409 },
    );
  }
  const note = MedicalEncounterNoteV1Schema.safeParse(draft.content);
  if (!note.success) {
    return NextResponse.json(
      { error: 'This is not a medical encounter note — differential is doctor-only.' },
      { status: 409 },
    );
  }
  const segments =
    (draft.speakerSegments as
      | {
          speaker: 'therapist' | 'client' | 'unknown';
          startMs: number;
          endMs: number;
          text: string;
        }[]
      | null) ?? [];

  await runDifferential({
    sessionId: session.id,
    psychologistId: session.psychologistId,
    language: (session.language as ClinicalLocale | undefined) ?? 'en',
    specialty: session.psychologist.specialty,
    transcript: draft.transcript,
    speakerSegments: segments,
    encounterNote: note.data,
  });

  const row = await prisma.differential.findUnique({ where: { sessionId } });
  if (!row) {
    return NextResponse.json({ error: 'Differential row missing after run' }, { status: 500 });
  }
  return NextResponse.json(toDifferentialResponse(row));
}

/**
 * GET /api/v1/sessions/:id/differential — read the current differential
 * (404 if none has been requested yet).
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
  const row = await prisma.differential.findUnique({ where: { sessionId } });
  if (!row) {
    return NextResponse.json({ error: 'No differential for this session yet.' }, { status: 404 });
  }
  return NextResponse.json(toDifferentialResponse(row));
}

/** Defensive row → DTO. Invalid stored body falls back to null. */
function toDifferentialResponse(row: Differential): DifferentialResponse {
  const parsed = row.body ? DifferentialDiagnosisV1Schema.safeParse(row.body) : null;
  return {
    status:
      row.status === 'COMPLETED' ? 'COMPLETED' : row.status === 'FAILED' ? 'FAILED' : 'PENDING',
    differential: parsed && parsed.success ? parsed.data : null,
    errorMessage: row.errorMessage,
  };
}
