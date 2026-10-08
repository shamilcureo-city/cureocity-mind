import { NextResponse, type NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { ApplyNoteTemplateInputSchema, TemplateSectionSchema } from '@cureocity/contracts';
import { requireCapability, requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { isBuiltinTemplateId, resolveBuiltinTemplate } from '@/lib/builtin-templates';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';
import { reformatNoteTemplate } from '@/lib/reformat-note-template';
import { ClientPhiWriteForbiddenError, lockActiveClientForSession } from '@/lib/phi-write-lock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** Reformat a version-checked current note, not the older audio. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await params;
  const dto = await parseJson(req, ApplyNoteTemplateInputSchema);
  if (!dto.ok) return dto.response;
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      noteDraft: true,
      therapyNote: { select: { locked: true } },
      noteEditRecovery: { select: { encryptedFields: true } },
      mindManualNoteDraft: { select: { encryptedFields: true } },
    },
  });
  if (!session || session.psychologistId !== auth.value.psychologistId)
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  if (session.therapyNote?.locked)
    return NextResponse.json(
      { error: 'Reopen the signed note before changing its format.' },
      { status: 409 },
    );
  if (session.noteEditRecovery?.encryptedFields || session.mindManualNoteDraft?.encryptedFields)
    return NextResponse.json(
      { error: 'Save or resolve your pending edits before changing the note format.' },
      { status: 409 },
    );
  let template: { name: string; sections: { title: string; hint?: string }[] } | null = null;
  if (dto.value.templateId !== null) {
    if (isBuiltinTemplateId(dto.value.templateId)) {
      template = resolveBuiltinTemplate(dto.value.templateId) ?? null;
    } else {
      const row = await prisma.noteTemplate.findFirst({
        where: {
          id: dto.value.templateId,
          psychologistId: auth.value.psychologistId,
        },
      });
      const sections = TemplateSectionSchema.array().min(1).max(20).safeParse(row?.sections);
      if (row && sections.success) template = { name: row.name, sections: sections.data };
    }
    if (!template) return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }
  const draft = session.noteDraft;
  if (
    draft &&
    (draft.status !== 'COMPLETED' ||
      !draft.content ||
      dto.value.expectedUpdatedAt !== draft.updatedAt.toISOString())
  )
    return NextResponse.json(
      { error: 'Reload the completed draft before changing its format.' },
      { status: 409 },
    );
  if (draft && session.mindDocumentationMode === 'MANUAL' && template)
    return NextResponse.json(
      { error: 'AI formatting is disabled for clinician-written sessions.' },
      { status: 409 },
    );
  const capability = await requireCapability(req, 'BEHAVIORAL_HEALTH_DOCUMENTATION', auth);
  if (!capability.ok) return capability.response;
  if (session.kind !== 'INTAKE' && session.kind !== 'TREATMENT' && session.kind !== 'REVIEW')
    return NextResponse.json(
      { error: 'Use the medical note format controls for this session.' },
      { status: 409 },
    );
  try {
    const content = draft
      ? await reformatNoteTemplate({
          sessionId,
          psychologistId: auth.value.psychologistId,
          kind: session.kind === 'INTAKE' ? 'INTAKE' : 'TREATMENT',
          content: draft.content,
          template,
        })
      : null;
    const currentAuth = await requireCapability(req, 'BEHAVIORAL_HEALTH_DOCUMENTATION', auth);
    if (!currentAuth.ok) return currentAuth.response;
    const saved = await prisma.$transaction(async (tx) => {
      await lockActiveClientForSession(tx, sessionId, auth.value.psychologistId);
      const current = await tx.session.findUnique({
        where: { id: sessionId },
        include: {
          noteDraft: true,
          therapyNote: { select: { locked: true } },
          noteEditRecovery: { select: { encryptedFields: true } },
          mindManualNoteDraft: { select: { encryptedFields: true } },
        },
      });
      if (
        !current ||
        current.psychologistId !== auth.value.psychologistId ||
        current.therapyNote?.locked ||
        current.noteEditRecovery?.encryptedFields ||
        current.mindManualNoteDraft?.encryptedFields ||
        current.kind !== session.kind ||
        current.mindDocumentationMode !== session.mindDocumentationMode ||
        current.noteTemplateId !== session.noteTemplateId ||
        (draft
          ? current.noteDraft?.updatedAt.getTime() !== draft.updatedAt.getTime()
          : !!current.noteDraft)
      )
        return null;
      const updated =
        content && draft
          ? await tx.noteDraft.update({
              where: { id: draft.id },
              data: { content: content as unknown as Prisma.InputJsonValue },
            })
          : null;
      await tx.session.update({
        where: { id: sessionId },
        data: { noteTemplateId: dto.value.templateId },
      });
      await writeAudit(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: auth.value.psychologistId,
          action: 'NOTE_TEMPLATE_APPLIED',
          targetType: 'Session',
          targetId: sessionId,
          metadata: {
            ...auditMetadataFromRequest(req),
            templateId: dto.value.templateId,
            source: draft ? 'CURRENT_CLINICIAN_NOTE' : 'FUTURE_NOTE',
          },
        },
        tx,
      );
      return {
        ok: true,
        templateId: dto.value.templateId,
        updatedAt: updated?.updatedAt.toISOString() ?? null,
      };
    });
    if (!saved)
      return NextResponse.json(
        {
          error:
            'The note changed or has unapplied edits. Reload and review it before changing format.',
        },
        { status: 409 },
      );
    return NextResponse.json(saved);
  } catch (error) {
    if (error instanceof ClientPhiWriteForbiddenError)
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    return NextResponse.json(
      { error: 'The new format could not be prepared. Your note has not changed; please retry.' },
      { status: 502 },
    );
  }
}
