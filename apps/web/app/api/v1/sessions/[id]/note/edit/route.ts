import { NextResponse, type NextRequest } from 'next/server';
import {
  IntakeNoteV1Schema,
  ReviseNoteInputSchema,
  TherapyNoteV1Schema,
  type IntakeNoteV1,
  type NoteEditField,
  type ReviseIntakeNoteInput,
  type ReviseTreatmentNoteInput,
  type TherapyNoteV1,
} from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/sessions/[id]/note/edit — revise a SIGNED note.
 *
 * Sprint 55 widens this route to both TREATMENT (SOAP) and INTAKE
 * notes via a `kind`-discriminated input. The server narrows against
 * `session.kind` and rejects mismatches; per-kind signable field sets
 * mirror the sign route so the two surfaces evolve in lockstep.
 *
 * The reason is appended to the audit metadata so the regulator can
 * reconstruct WHY a signed clinical document was modified. We use the
 * existing NOTE_SIGNED audit verb with metadata `{ revision: true,
 * kind }` — revising essentially re-signs the document, keeping the
 * audit surface additive without enum sprawl.
 */

// Duplicated from sign/route.ts:27. A shared helper would have one
// caller per route and adds indirection for a 12-line constant;
// either both lift it together or neither.
const SIGNABLE_BY_KIND: Record<'TREATMENT' | 'INTAKE', readonly NoteEditField[]> = {
  TREATMENT: ['subjective', 'objective', 'assessment', 'plan'],
  INTAKE: [
    'presentingConcerns',
    'historyOfPresentingIllness',
    'pastPsychiatricHistory',
    'familyHistory',
    'socialHistory',
    'mentalStatusExam',
    'workingHypothesis',
    'immediatePlan',
  ],
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await params;
  const body = await parseJson(req, ReviseNoteInputSchema);
  if (!body.ok) return body.response;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true, psychologistId: true, kind: true, therapyNote: true },
  });
  if (!session || session.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  if (!session.therapyNote || !session.therapyNote.content) {
    return NextResponse.json(
      { error: 'Session has no signed note to revise.' },
      { status: 404 },
    );
  }

  // Server is the source of truth on kind. A mismatch usually means a
  // stale UI tab — return 400 so the client refetches rather than
  // silently writing a SOAP edit onto an intake note (or vice versa).
  // REVIEW sessions have no signed note path of their own (the kind
  // produces a brief, not a signable note), so they never reach here
  // via the happy path; explicit reject keeps the contract clean.
  if (session.kind === 'REVIEW' || session.kind !== body.value.kind) {
    return NextResponse.json(
      {
        error: `This session is ${session.kind}; expected a ${body.value.kind} revision payload.`,
      },
      { status: 400 },
    );
  }

  const therapyNoteId = session.therapyNote.id;
  const auditMeta = auditMetadataFromRequest(req);

  if (session.kind === 'TREATMENT') {
    const input = body.value as ReviseTreatmentNoteInput;
    const current = TherapyNoteV1Schema.parse(session.therapyNote.content);
    const edits: Array<{ field: NoteEditField; before: string; after: string }> = [];
    for (const field of SIGNABLE_BY_KIND.TREATMENT) {
      const key = field as 'subjective' | 'objective' | 'assessment' | 'plan';
      const next = input[key];
      if (next !== undefined && next !== current[key]) {
        edits.push({ field, before: current[key], after: next });
      }
    }
    if (edits.length === 0) {
      return NextResponse.json(
        { error: 'No fields changed from the current signed note.' },
        { status: 422 },
      );
    }

    const nextContent: TherapyNoteV1 = {
      ...current,
      ...(input.subjective !== undefined && { subjective: input.subjective }),
      ...(input.objective !== undefined && { objective: input.objective }),
      ...(input.assessment !== undefined && { assessment: input.assessment }),
      ...(input.plan !== undefined && { plan: input.plan }),
    };
    // Defensive re-parse — mirrors sign/route.ts.
    TherapyNoteV1Schema.parse(nextContent);

    await prisma.$transaction(async (tx) => {
      await tx.noteEdit.createMany({
        data: edits.map((e) => ({
          therapyNoteId,
          field: e.field,
          before: e.before,
          after: e.after,
        })),
      });
      await tx.therapyNote.update({
        where: { id: therapyNoteId },
        data: { content: nextContent as unknown as object },
      });
      await writeAudit(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: auth.value.psychologistId,
          action: 'NOTE_SIGNED',
          targetType: 'TherapyNote',
          targetId: therapyNoteId,
          metadata: {
            ...auditMeta,
            revision: true,
            kind: 'TREATMENT',
            sessionId: session.id,
            fieldsChanged: edits.map((e) => e.field),
            reason: input.reason,
          },
        },
        tx,
      );
    });

    return NextResponse.json({
      sessionId,
      therapyNoteId,
      kind: 'TREATMENT' as const,
      fieldsChanged: edits.map((e) => e.field),
      content: nextContent,
    });
  }

  // INTAKE branch
  const input = body.value as ReviseIntakeNoteInput;
  const current = IntakeNoteV1Schema.parse(session.therapyNote.content);
  const intakeFields = SIGNABLE_BY_KIND.INTAKE;
  const edits: Array<{ field: NoteEditField; before: string; after: string }> = [];
  for (const field of intakeFields) {
    const key = field as keyof IntakeNoteV1 & keyof ReviseIntakeNoteInput;
    const next = input[key] as string | undefined;
    const before = current[key];
    if (next !== undefined && typeof before === 'string' && next !== before) {
      edits.push({ field, before, after: next });
    }
  }
  if (edits.length === 0) {
    return NextResponse.json(
      { error: 'No fields changed from the current signed note.' },
      { status: 422 },
    );
  }

  const patch: Partial<IntakeNoteV1> = {};
  for (const field of intakeFields) {
    const key = field as keyof IntakeNoteV1 & keyof ReviseIntakeNoteInput;
    const next = input[key] as string | undefined;
    if (next !== undefined) {
      (patch as Record<string, string>)[key] = next;
    }
  }
  // Re-parse with IntakeNoteV1Schema so the lenient mentalStatusExam
  // preprocess (CLAUDE.md §7) re-runs over the merged content.
  const nextContent = IntakeNoteV1Schema.parse({ ...current, ...patch });

  await prisma.$transaction(async (tx) => {
    await tx.noteEdit.createMany({
      data: edits.map((e) => ({
        therapyNoteId,
        field: e.field,
        before: e.before,
        after: e.after,
      })),
    });
    await tx.therapyNote.update({
      where: { id: therapyNoteId },
      data: { content: nextContent as unknown as object },
    });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'NOTE_SIGNED',
        targetType: 'TherapyNote',
        targetId: therapyNoteId,
        metadata: {
          ...auditMeta,
          revision: true,
          kind: 'INTAKE',
          sessionId: session.id,
          fieldsChanged: edits.map((e) => e.field),
          reason: input.reason,
        },
      },
      tx,
    );
  });

  return NextResponse.json({
    sessionId,
    therapyNoteId,
    kind: 'INTAKE' as const,
    fieldsChanged: edits.map((e) => e.field),
    content: nextContent,
  });
}
