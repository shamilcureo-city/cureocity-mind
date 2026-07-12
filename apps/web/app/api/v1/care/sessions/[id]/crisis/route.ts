import { NextResponse, type NextRequest } from 'next/server';
import { CareCrisisInputSchema } from '@cureocity/contracts';
import { auditMetadataFromRequest } from '@/lib/audit';
import { requireCareUserId } from '@/lib/care-auth';
import { crisisResources, escalateCareSession } from '@/lib/care-safety';
import { parseJson } from '@/lib/validate';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/care/sessions/[id]/crisis (AC6, §2 layer 4b) — the two
 * client-side crisis triggers land here: the model's flag_crisis tool
 * call, and the user's own "I need help now" tap. Same escalation path
 * as the server-side keyword screen; the response carries the takeover
 * screen's resources.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireCareUserId(req);
  if (!auth.ok) return auth.response;
  const { id: careSessionId } = await params;
  const input = await parseJson(req, CareCrisisInputSchema);
  if (!input.ok) return input.response;

  const session = await prisma.careSession.findUnique({
    where: { id: careSessionId },
    select: { id: true, careUserId: true, status: true },
  });
  if (!session || session.careUserId !== auth.value.careUserId) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  if (session.status !== 'CRISIS_ESCALATED') {
    await escalateCareSession({
      careSessionId,
      careUserId: auth.value.careUserId,
      source: input.value.source,
      metadata: { ...auditMetadataFromRequest(req), reason: input.value.reason },
    });
  }

  const { careUser } = auth.value;
  return NextResponse.json({
    status: 'CRISIS_ESCALATED',
    resources: crisisResources(careUser.spokenLanguages),
    trustedContact: careUser.trustedContactName
      ? { name: careUser.trustedContactName, phone: careUser.trustedContactPhone }
      : null,
  });
}
