import { NextResponse, type NextRequest } from 'next/server';
import { ApplyNoteTemplateInputSchema } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { isBuiltinTemplateId, resolveBuiltinTemplate } from '@/lib/builtin-templates';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/sessions/[id]/note-template — Sprint 70.
 *
 * Choose the note template for a session. The caller then re-generates the
 * note (POST /generate-note), and Pass 2 reads `session.noteTemplateId` to
 * also produce the note in that template's sections. `templateId: null`
 * clears the template (back to the built-in SOAP structure).
 *
 * Tenant-gated on both the session and the template; audits
 * NOTE_TEMPLATE_APPLIED.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await params;
  const dto = await parseJson(req, ApplyNoteTemplateInputSchema);
  if (!dto.ok) return dto.response;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { psychologistId: true },
  });
  if (!session || session.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  // A built-in template (from the static catalog) is available to everyone;
  // a custom template must belong to the requesting therapist.
  if (dto.value.templateId !== null) {
    if (isBuiltinTemplateId(dto.value.templateId)) {
      if (!resolveBuiltinTemplate(dto.value.templateId)) {
        return NextResponse.json({ error: 'Template not found' }, { status: 404 });
      }
    } else {
      const tpl = await prisma.noteTemplate.findUnique({
        where: { id: dto.value.templateId },
        select: { psychologistId: true },
      });
      if (!tpl || tpl.psychologistId !== auth.value.psychologistId) {
        return NextResponse.json({ error: 'Template not found' }, { status: 404 });
      }
    }
  }

  await prisma.session.update({
    where: { id: sessionId },
    data: { noteTemplateId: dto.value.templateId },
  });

  await writeAudit({
    actorType: 'PSYCHOLOGIST',
    actorPsychologistId: auth.value.psychologistId,
    action: 'NOTE_TEMPLATE_APPLIED',
    targetType: 'Session',
    targetId: sessionId,
    metadata: { ...auditMetadataFromRequest(req), templateId: dto.value.templateId },
  });

  return NextResponse.json({ ok: true, templateId: dto.value.templateId });
}
