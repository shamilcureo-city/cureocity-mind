import { NextResponse, type NextRequest } from 'next/server';
import { UpdateNoteTemplateInputSchema } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { toNoteTemplate } from '@/lib/mappers';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/v1/templates/[id] — partial update. If isDefault is
 * flipped on, the prior default is auto-demoted in the same tx so
 * the "exactly one default per therapist" invariant holds.
 *
 * DELETE /api/v1/templates/[id] — hard delete. The default flag
 * isn't auto-migrated to another row; the therapist sees the no-
 * default state in the list and can pick a new one.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = await parseJson(req, UpdateNoteTemplateInputSchema);
  if (!body.ok) return body.response;

  const existing = await prisma.noteTemplate.findUnique({ where: { id } });
  if (!existing || existing.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (body.value.isDefault === true) {
      await tx.noteTemplate.updateMany({
        where: {
          psychologistId: auth.value.psychologistId,
          isDefault: true,
          NOT: { id },
        },
        data: { isDefault: false },
      });
    }
    const row = await tx.noteTemplate.update({
      where: { id },
      data: {
        ...(body.value.name !== undefined && { name: body.value.name }),
        ...(body.value.description !== undefined && { description: body.value.description }),
        ...(body.value.sections !== undefined && {
          sections: body.value.sections as unknown as Parameters<
            typeof tx.noteTemplate.update
          >[0]['data']['sections'],
        }),
        ...(body.value.isDefault !== undefined && { isDefault: body.value.isDefault }),
      },
    });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'TEMPLATE_UPDATED',
        targetType: 'NoteTemplate',
        targetId: row.id,
        metadata: {
          ...auditMetadataFromRequest(req),
          fieldsChanged: Object.keys(body.value),
        },
      },
      tx,
    );
    return row;
  });

  return NextResponse.json(toNoteTemplate(updated));
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const existing = await prisma.noteTemplate.findUnique({ where: { id } });
  if (!existing || existing.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.noteTemplate.delete({ where: { id } });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'TEMPLATE_DELETED',
        targetType: 'NoteTemplate',
        targetId: id,
        metadata: {
          ...auditMetadataFromRequest(req),
          name: existing.name,
          wasDefault: existing.isDefault,
        },
      },
      tx,
    );
  });

  return new NextResponse(null, { status: 204 });
}
