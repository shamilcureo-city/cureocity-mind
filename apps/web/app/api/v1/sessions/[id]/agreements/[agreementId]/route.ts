import { createHash } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import {
  AgreementCorrectionInputSchema,
  AgreementRevisionHistorySchema,
  UpdateAgreementInputSchema,
  RetireAgreementInputSchema,
} from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';
import { ClientPhiWriteForbiddenError, lockActiveClientForSession } from '@/lib/phi-write-lock';
import {
  agreementContextInclude,
  toSessionAgreementDto,
  withAgreementHomeworkAccess,
} from '@/lib/session-agreement-view';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string; agreementId: string }> };
const PatchSchema = z.union([
  AgreementCorrectionInputSchema,
  UpdateAgreementInputSchema.strict(),
  RetireAgreementInputSchema,
]);
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** One canonical care record. Corrections retain before/after history on the clinical row;
 * signed notes are never edited. Follow-up marks remain separate from content amendments. */
export async function PATCH(req: NextRequest, { params }: Context): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const toDto = (row: Parameters<typeof toSessionAgreementDto>[0]) =>
    withAgreementHomeworkAccess(
      toSessionAgreementDto(row),
      auth.value.user?.capabilities?.includes('THERAPY_WORKFLOWS') ?? false,
    );
  const { id: sessionId, agreementId } = await params;
  const body = await parseJson(req, PatchSchema);
  if (!body.ok) return body.response;
  try {
    return await prisma.$transaction(async (tx) => {
      const client = await lockActiveClientForSession(tx, sessionId, auth.value.psychologistId);
      const row = await tx.sessionAgreement.findFirst({
        where: {
          id: agreementId,
          sessionId,
          clientId: client.id,
          psychologistId: auth.value.psychologistId,
        },
        include: agreementContextInclude,
      });
      if (!row) return NextResponse.json({ error: 'Agreement not found' }, { status: 404 });
      if ('operation' in body.value && body.value.operation === 'retire') {
        if (body.value.expectedRevision !== row.revision)
          return NextResponse.json(
            { error: 'This agreement changed. Reload before retiring it.' },
            { status: 409 },
          );
        if (row.retiredAt) {
          if (row.retirementReason !== body.value.reason)
            return NextResponse.json(
              { error: 'This agreement was already retired with a different reason.' },
              { status: 409 },
            );
          return NextResponse.json({ agreement: toDto(row) });
        }
        if (row.followUp === 'DONE')
          return NextResponse.json(
            {
              error:
                'This commitment is already completed. Reload its saved follow-up before making another decision.',
            },
            { status: 409 },
          );
        const saved = await tx.sessionAgreement.update({
          where: { id: agreementId },
          include: agreementContextInclude,
          data: {
            retiredAt: new Date(),
            retirementReason: body.value.reason,
          },
        });
        await writeAudit(
          {
            actorType: 'PSYCHOLOGIST',
            actorPsychologistId: auth.value.psychologistId,
            action: 'AGREEMENT_RECORDED',
            targetType: 'SessionAgreement',
            targetId: agreementId,
            metadata: {
              ...auditMetadataFromRequest(req),
              sessionId,
              clientId: client.id,
              op: 'retire',
              revision: row.revision,
            },
          },
          tx,
        );
        return NextResponse.json({ agreement: toDto(saved) });
      }
      if ('followUp' in body.value) {
        if (row.retiredAt)
          return NextResponse.json(
            {
              error:
                'This agreement is retired. Review its history before recording further follow-up.',
            },
            { status: 409 },
          );
        if ((body.value.expectedRevision ?? 0) !== row.revision)
          return NextResponse.json(
            {
              error:
                'This agreement was corrected. Reload its latest wording before recording follow-up.',
            },
            { status: 409 },
          );
        if (row.followUp === body.value.followUp) return NextResponse.json({ ok: true });
        await tx.sessionAgreement.update({
          where: { id: agreementId },
          data: { followUp: body.value.followUp, followUpAt: new Date() },
        });
        await writeAudit(
          {
            actorType: 'PSYCHOLOGIST',
            actorPsychologistId: auth.value.psychologistId,
            action: 'AGREEMENT_RECORDED',
            targetType: 'SessionAgreement',
            targetId: agreementId,
            metadata: {
              ...auditMetadataFromRequest(req),
              sessionId,
              clientId: client.id,
              op: 'follow-up',
              followUp: body.value.followUp,
            },
          },
          tx,
        );
        return NextResponse.json({ ok: true });
      }
      const input = body.value;
      const parsed = AgreementRevisionHistorySchema.safeParse(row.revisions ?? []);
      if (!parsed.success || parsed.data.length !== row.revision)
        return NextResponse.json(
          { error: 'Agreement history needs review before it can be changed.' },
          { status: 409 },
        );
      const revisions = parsed.data;
      if (
        revisions.some(
          (entry, index) =>
            entry.revision !== index + 1 ||
            (index > 0 &&
              (entry.previousText !== revisions[index - 1]!.text ||
                entry.previousSpeaker !== revisions[index - 1]!.speaker)),
        ) ||
        (revisions.length > 0 &&
          (revisions.at(-1)!.text !== row.text || revisions.at(-1)!.speaker !== row.speaker))
      )
        return NextResponse.json(
          { error: 'Agreement history needs review before it can be changed.' },
          { status: 409 },
        );
      const priorAttempt = revisions.find((revision) => revision.operationId === input.operationId);
      if (priorAttempt) {
        if (
          priorAttempt.text !== input.text ||
          priorAttempt.speaker !== input.speaker ||
          priorAttempt.reason !== input.reason ||
          priorAttempt.operation !== input.operation
        )
          return NextResponse.json(
            { error: 'This save identifier was already used for a different correction.' },
            { status: 409 },
          );
        return NextResponse.json({
          agreement: toDto(row),
          operationId: input.operationId,
        });
      }
      if (row.revision !== input.expectedRevision)
        return NextResponse.json(
          {
            error:
              'This agreement changed elsewhere. Reload agreements and review the latest wording before saving.',
          },
          { status: 409 },
        );
      if (row.text === input.text && row.speaker === input.speaker)
        return NextResponse.json(
          { error: 'Change the wording or attribution before saving a correction.' },
          { status: 422 },
        );
      // Sign and erase take the same client lock. An unlocked previously signed note
      // still requires an explicit amendment to its separate care decisions.
      const note = await tx.therapyNote.findUnique({ where: { sessionId }, select: { id: true } });
      if (note && input.operation !== 'amend')
        return NextResponse.json(
          {
            error:
              'This session has a signed note. Reload and use Save separate amendment; the note itself will not change.',
          },
          { status: 409 },
        );
      if (!note && input.operation === 'amend')
        return NextResponse.json(
          { error: 'This note is not signed. Reload and use Save correction.' },
          { status: 409 },
        );
      if (revisions.length >= 100)
        return NextResponse.json(
          {
            error:
              'The agreement revision limit has been reached. Contact support before making another correction.',
          },
          { status: 422 },
        );
      const revision = {
        revision: row.revision + 1,
        operationId: input.operationId,
        operation: input.operation,
        reason: input.reason,
        previousText: row.text,
        previousSpeaker: row.speaker,
        previousFollowUp: row.followUp,
        previousFollowUpAt: row.followUpAt?.toISOString() ?? null,
        previousRetiredAt: row.retiredAt?.toISOString() ?? null,
        previousRetirementReason: row.retirementReason ?? null,
        text: input.text,
        speaker: input.speaker,
        recordedAt: new Date().toISOString(),
        recordedBy: auth.value.psychologistId,
        signedNoteId: note?.id ?? null,
      };
      const saved = await tx.sessionAgreement.update({
        where: { id: agreementId },
        include: agreementContextInclude,
        data: {
          text: input.text,
          speaker: input.speaker,
          revision: row.revision + 1,
          revisions: [...revisions, revision],
          // The clinician explicitly reviewed the reset notice. Never apply a
          // completion mark for old wording to a newly corrected care decision.
          followUp: null,
          followUpAt: null,
          retiredAt: null,
          retirementReason: null,
        },
      });
      await writeAudit(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: auth.value.psychologistId,
          action: 'AGREEMENT_RECORDED',
          targetType: 'SessionAgreement',
          targetId: agreementId,
          metadata: {
            ...auditMetadataFromRequest(req),
            sessionId,
            clientId: client.id,
            op: input.operation,
            operationId: input.operationId,
            revision: revision.revision,
            reason: input.reason,
            signedNoteId: note?.id ?? null,
            beforeHash: hash({ text: row.text, speaker: row.speaker }),
            afterHash: hash({ text: input.text, speaker: input.speaker }),
          },
        },
        tx,
      );
      return NextResponse.json({
        agreement: toDto(saved),
        operationId: input.operationId,
      });
    });
  } catch (error) {
    if (error instanceof ClientPhiWriteForbiddenError)
      return NextResponse.json({ error: 'Agreement not found' }, { status: 404 });
    throw error;
  }
}

/** Removing a pre-sign entry recorded in error is audited. Signed-session content
 * can only be amended with preserved history, never silently deleted. */
export async function DELETE(req: NextRequest, { params }: Context): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: sessionId, agreementId } = await params;
  const body = await parseJson(
    req,
    z.object({ expectedRevision: z.number().int().min(0) }).strict(),
  );
  if (!body.ok) return body.response;
  try {
    return await prisma.$transaction(async (tx) => {
      const client = await lockActiveClientForSession(tx, sessionId, auth.value.psychologistId);
      const row = await tx.sessionAgreement.findFirst({
        where: {
          id: agreementId,
          sessionId,
          clientId: client.id,
          psychologistId: auth.value.psychologistId,
        },
      });
      if (!row) return NextResponse.json({ error: 'Agreement not found' }, { status: 404 });
      const note = await tx.therapyNote.findUnique({ where: { sessionId }, select: { id: true } });
      if (note)
        return NextResponse.json(
          {
            error:
              'Signed-session agreements cannot be removed. Save a separate amendment instead.',
          },
          { status: 409 },
        );
      if (row.revision !== body.value.expectedRevision || row.followUp !== null || row.retiredAt)
        return NextResponse.json(
          {
            error:
              'This agreement has changed or has recorded follow-up. Reload and use a correction to preserve its context.',
          },
          { status: 409 },
        );
      const linkedHomework = await tx.exerciseAssignment.findFirst({
        where: { sourceAgreementId: agreementId },
        select: { id: true },
      });
      if (linkedHomework)
        return NextResponse.json(
          {
            error:
              'This agreement has linked homework. Retire or correct it to preserve its source; existing homework will not change.',
          },
          { status: 409 },
        );
      await tx.sessionAgreement.delete({ where: { id: agreementId } });
      await writeAudit(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: auth.value.psychologistId,
          action: 'AGREEMENT_RECORDED',
          targetType: 'SessionAgreement',
          targetId: agreementId,
          metadata: {
            ...auditMetadataFromRequest(req),
            sessionId,
            clientId: client.id,
            op: 'delete',
            revision: row.revision,
          },
        },
        tx,
      );
      return NextResponse.json({ ok: true });
    });
  } catch (error) {
    if (error instanceof ClientPhiWriteForbiddenError)
      return NextResponse.json({ error: 'Agreement not found' }, { status: 404 });
    throw error;
  }
}
