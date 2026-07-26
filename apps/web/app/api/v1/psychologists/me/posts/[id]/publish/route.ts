import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePsychologistId } from '@/lib/auth-server';
import { parseJson } from '@/lib/validate';
import { prisma } from '@/lib/prisma';
import { writeAudit } from '@/lib/audit';
import { getEntitlement } from '@/lib/billing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PublishPostSchema = z.object({ publish: z.boolean() });

/**
 * MK5 — flip a post live / back to draft. Publishing requires the
 * profile itself to be published (a post with no parent page would
 * 404 anyway).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = await parseJson(req, PublishPostSchema);
  if (!body.ok) return body.response;

  const post = await prisma.profilePost.findUnique({ where: { id } });
  if (!post || post.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (body.value.publish) {
    // MK7 — writing is a paid-plan feature; the page/bookings stay free.
    if ((await getEntitlement(auth.value.psychologistId)).plan === 'FREE_TRIAL') {
      return NextResponse.json(
        { error: 'Writing is part of the paid plan — upgrade to publish articles.' },
        { status: 403 },
      );
    }
    const me = await prisma.psychologist.findUnique({
      where: { id: auth.value.psychologistId },
      select: { profilePublishedAt: true },
    });
    if (!me?.profilePublishedAt) {
      return NextResponse.json(
        { error: 'Publish your page first — posts live on it.' },
        { status: 422 },
      );
    }
    await prisma.profilePost.update({
      where: { id },
      data: { status: 'PUBLISHED', publishedAt: post.publishedAt ?? new Date() },
    });
    await writeAudit({
      actorType: 'PSYCHOLOGIST',
      actorPsychologistId: auth.value.psychologistId,
      action: 'PROFILE_POST_PUBLISHED',
      targetType: 'ProfilePost',
      targetId: id,
      metadata: { slug: post.slug },
    });
  } else {
    await prisma.profilePost.update({ where: { id }, data: { status: 'DRAFT' } });
  }
  return NextResponse.json({ published: body.value.publish });
}
