import { NextResponse, type NextRequest } from 'next/server';
import {
  UpsertProfilePostInputSchema,
  type ProfilePost as ProfilePostDto,
} from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { parseJson } from '@/lib/validate';
import { prisma } from '@/lib/prisma';
import { slugify } from '@/lib/marketing';
import { getEntitlement } from '@/lib/billing';
import type { ProfilePost } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * MK5 — the therapist's profile posts. GET lists; POST creates or
 * updates (by id) a DRAFT. Publishing is a separate, explicit act
 * (posts/[id]/publish) so nothing reaches the public page unreviewed.
 */

function toDto(row: ProfilePost): ProfilePostDto {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    body: row.body,
    topic: row.topic,
    status: row.status,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const rows = await prisma.profilePost.findMany({
    where: { psychologistId: auth.value.psychologistId },
    orderBy: { updatedAt: 'desc' },
    take: 50,
  });
  return NextResponse.json({ items: rows.map(toDto) });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const psyId = auth.value.psychologistId;
  // MK7 — writing is a paid-plan feature; the page/bookings stay free.
  if ((await getEntitlement(psyId)).plan === 'FREE_TRIAL') {
    return NextResponse.json(
      { error: 'Writing is part of the paid plan — upgrade to publish articles.' },
      { status: 403 },
    );
  }
  const body = await parseJson(req, UpsertProfilePostInputSchema);
  if (!body.ok) return body.response;

  if (body.value.id) {
    const existing = await prisma.profilePost.findUnique({ where: { id: body.value.id } });
    if (!existing || existing.psychologistId !== psyId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const row = await prisma.profilePost.update({
      where: { id: body.value.id },
      data: {
        title: body.value.title,
        body: body.value.body,
        topic: body.value.topic ?? null,
      },
    });
    return NextResponse.json(toDto(row));
  }

  // New post: derive a unique per-therapist slug from the title.
  const base = slugify(body.value.title);
  let slug = base;
  for (let i = 2; i < 30; i++) {
    const taken = await prisma.profilePost.findUnique({
      where: { psychologistId_slug: { psychologistId: psyId, slug } },
      select: { id: true },
    });
    if (!taken) break;
    slug = `${base}-${i}`;
  }
  const row = await prisma.profilePost.create({
    data: {
      psychologistId: psyId,
      slug,
      title: body.value.title,
      body: body.value.body,
      topic: body.value.topic ?? null,
    },
  });
  return NextResponse.json(toDto(row), { status: 201 });
}
