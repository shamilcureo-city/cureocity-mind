import { NextResponse, type NextRequest } from 'next/server';
import { CreateNoteTemplateInputSchema } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { toNoteTemplate } from '@/lib/mappers';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/templates — list the therapist's templates, default
 * first then newest first. POST /api/v1/templates — create a new
 * template; if isDefault=true the prior default is auto-demoted
 * inside the same tx so the "exactly one default" invariant holds
 * without a DB unique constraint.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const rows = await prisma.noteTemplate.findMany({
    where: { psychologistId: auth.value.psychologistId },
    orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
    take: 100,
  });
  return NextResponse.json({ items: rows.map(toNoteTemplate) });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const body = await parseJson(req, CreateNoteTemplateInputSchema);
  if (!body.ok) return body.response;

  const created = await prisma.$transaction(async (tx) => {
    if (body.value.isDefault) {
      await tx.noteTemplate.updateMany({
        where: { psychologistId: auth.value.psychologistId, isDefault: true },
        data: { isDefault: false },
      });
    }
    const row = await tx.noteTemplate.create({
      data: {
        psychologistId: auth.value.psychologistId,
        name: body.value.name,
        ...(body.value.description !== undefined && { description: body.value.description }),
        sections: body.value.sections as unknown as Parameters<
          typeof tx.noteTemplate.create
        >[0]['data']['sections'],
        isDefault: body.value.isDefault ?? false,
      },
    });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'TEMPLATE_CREATED',
        targetType: 'NoteTemplate',
        targetId: row.id,
        metadata: {
          ...auditMetadataFromRequest(req),
          name: body.value.name,
          sectionCount: body.value.sections.length,
          isDefault: row.isDefault,
        },
      },
      tx,
    );
    return row;
  });

  return NextResponse.json(toNoteTemplate(created), { status: 201 });
}
