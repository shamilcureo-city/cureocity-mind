import { NextResponse, type NextRequest } from 'next/server';
import { PublishMarketingInputSchema } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { parseJson } from '@/lib/validate';
import { prisma } from '@/lib/prisma';
import { writeAudit } from '@/lib/audit';
import { checklistComplete, profilePublishChecklist } from '@/lib/marketing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/psychologists/me/marketing/publish
 *
 * Flips the public page live / down. Publishing is refused until the
 * checklist passes (headline, bio, city, ≥1 specialty) — the same rule
 * the studio shows, enforced server-side.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const body = await parseJson(req, PublishMarketingInputSchema);
  if (!body.ok) return body.response;

  const me = await prisma.psychologist.findUnique({
    where: { id: auth.value.psychologistId },
    select: {
      vertical: true,
      publicSlug: true,
      profilePublishedAt: true,
      headline: true,
      bio: true,
      locationCity: true,
      specialties: true,
    },
  });
  if (!me) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (me.vertical !== 'THERAPIST') {
    return NextResponse.json(
      { error: 'Marketing pages are therapist-only in V1' },
      { status: 409 },
    );
  }

  if (body.value.publish) {
    const checklist = profilePublishChecklist(me);
    if (!checklistComplete(checklist) || !me.publicSlug) {
      return NextResponse.json(
        { error: 'Complete the checklist before publishing.', checklist },
        { status: 422 },
      );
    }
    await prisma.psychologist.update({
      where: { id: auth.value.psychologistId },
      data: { profilePublishedAt: me.profilePublishedAt ?? new Date() },
    });
    await writeAudit({
      actorType: 'PSYCHOLOGIST',
      actorPsychologistId: auth.value.psychologistId,
      action: 'THERAPIST_PROFILE_PUBLISHED',
      targetType: 'Psychologist',
      targetId: auth.value.psychologistId,
      metadata: { slug: me.publicSlug },
    });
  } else {
    await prisma.psychologist.update({
      where: { id: auth.value.psychologistId },
      data: { profilePublishedAt: null },
    });
    await writeAudit({
      actorType: 'PSYCHOLOGIST',
      actorPsychologistId: auth.value.psychologistId,
      action: 'THERAPIST_PROFILE_UNPUBLISHED',
      targetType: 'Psychologist',
      targetId: auth.value.psychologistId,
      metadata: { slug: me.publicSlug },
    });
  }
  return NextResponse.json({ published: body.value.publish });
}
