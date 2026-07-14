import { NextResponse, type NextRequest } from 'next/server';
import { CareResonanceInputSchema } from '@cureocity/contracts';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { requireCareUserId } from '@/lib/care-auth';
import { parseJson } from '@/lib/validate';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * CG2 — POST /api/v1/care/reports/[id]/resonance — the reveal's one-tap
 * "did this feel like it understood you?" check. One audit row per answer
 * (the pilot analytics substrate, no dedicated table); the metadata carries
 * language + persona so resonance can be sliced for prompt regressions.
 * A "not_really" also models rupture-repair: the client pre-fills the next
 * session's topic so the persona opens by asking what it missed.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireCareUserId(req);
  if (!auth.ok) return auth.response;
  const { id: reportId } = await params;
  const input = await parseJson(req, CareResonanceInputSchema);
  if (!input.ok) return input.response;

  const report = await prisma.careReport.findUnique({
    where: { id: reportId },
    select: { id: true, kind: true, careSession: { select: { careUserId: true } } },
  });
  if (!report || report.careSession.careUserId !== auth.value.careUserId) {
    return NextResponse.json({ error: 'Report not found' }, { status: 404 });
  }

  await writeAudit({
    actorType: 'CLIENT',
    action: 'CARE_ASSESSMENT_RESONANCE',
    targetType: 'CareReport',
    targetId: report.id,
    metadata: {
      ...auditMetadataFromRequest(req),
      answer: input.value.answer,
      reportKind: report.kind,
      personaName: auth.value.careUser.personaName,
      preferredLanguage: auth.value.careUser.preferredLanguage,
    },
  });

  return NextResponse.json({ ok: true });
}
