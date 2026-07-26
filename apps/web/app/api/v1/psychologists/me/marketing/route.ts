import { NextResponse, type NextRequest } from 'next/server';
import { UpdateMarketingInputSchema, type MarketingState } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { parseJson } from '@/lib/validate';
import { prisma } from '@/lib/prisma';
import { writeAudit } from '@/lib/audit';
import { profilePublishChecklist, slugify } from '@/lib/marketing';
import { parseFaqs } from '@/lib/public-profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Marketing V1 — the therapist's own marketing state.
 *
 * GET returns slug + publish state + FAQs + the publish checklist.
 * A therapist with no slug yet gets one auto-generated (and persisted)
 * on first GET, so the studio always has a URL to show.
 *
 * PATCH updates slug and/or FAQs. Slug collisions 409. Profile FIELDS
 * (headline, bio, …) are PATCHed via the existing /psychologists/me.
 */

const MARKETING_SELECT = {
  id: true,
  fullName: true,
  vertical: true,
  publicSlug: true,
  profilePublishedAt: true,
  profileFaqs: true,
  headline: true,
  bio: true,
  locationCity: true,
  specialties: true,
} as const;

type Row = {
  id: string;
  fullName: string;
  publicSlug: string | null;
  profilePublishedAt: Date | null;
  profileFaqs: unknown;
  headline: string | null;
  bio: string | null;
  locationCity: string | null;
  specialties: string[];
};

function toState(row: Row): MarketingState {
  return {
    publicSlug: row.publicSlug,
    publishedAt: row.profilePublishedAt?.toISOString() ?? null,
    faqs: parseFaqs(row.profileFaqs),
    checklist: profilePublishChecklist(row),
    publicUrl: row.profilePublishedAt && row.publicSlug ? `/therapists/${row.publicSlug}` : null,
  };
}

async function ensureSlug(row: Row): Promise<Row> {
  if (row.publicSlug) return row;
  const base = slugify(row.fullName);
  for (let i = 0; i < 20; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const taken = await prisma.psychologist.findUnique({
      where: { publicSlug: candidate },
      select: { id: true },
    });
    if (!taken) {
      await prisma.psychologist.update({
        where: { id: row.id },
        data: { publicSlug: candidate },
      });
      return { ...row, publicSlug: candidate };
    }
  }
  return row;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const found = await prisma.psychologist.findUnique({
    where: { id: auth.value.psychologistId },
    select: MARKETING_SELECT,
  });
  if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (found.vertical !== 'THERAPIST') {
    return NextResponse.json(
      { error: 'Marketing pages are therapist-only in V1' },
      { status: 409 },
    );
  }
  const row = await ensureSlug(found);
  return NextResponse.json(toState(row));
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const body = await parseJson(req, UpdateMarketingInputSchema);
  if (!body.ok) return body.response;

  const me = await prisma.psychologist.findUnique({
    where: { id: auth.value.psychologistId },
    select: { vertical: true },
  });
  if (me?.vertical !== 'THERAPIST') {
    return NextResponse.json(
      { error: 'Marketing pages are therapist-only in V1' },
      { status: 409 },
    );
  }

  if (body.value.publicSlug) {
    const taken = await prisma.psychologist.findUnique({
      where: { publicSlug: body.value.publicSlug },
      select: { id: true },
    });
    if (taken && taken.id !== auth.value.psychologistId) {
      return NextResponse.json({ error: 'That URL is already taken.' }, { status: 409 });
    }
  }

  const row = await prisma.psychologist.update({
    where: { id: auth.value.psychologistId },
    data: {
      ...(body.value.publicSlug && { publicSlug: body.value.publicSlug }),
      ...(body.value.faqs && { profileFaqs: body.value.faqs }),
      ...(body.value.credentialsLine !== undefined && {
        credentialsLine: body.value.credentialsLine,
      }),
      ...(body.value.pronouns !== undefined && { pronouns: body.value.pronouns }),
      ...(body.value.officeAddress !== undefined && { officeAddress: body.value.officeAddress }),
    },
    select: MARKETING_SELECT,
  });
  // Reuses the existing profile-update action — the marketing studio is
  // just another editor of the same public profile.
  await writeAudit({
    actorType: 'PSYCHOLOGIST',
    actorPsychologistId: auth.value.psychologistId,
    action: 'PSYCHOLOGIST_UPDATED',
    targetType: 'Psychologist',
    targetId: auth.value.psychologistId,
    metadata: { fields: Object.keys(body.value), source: 'marketing' },
  });
  return NextResponse.json(toState(row));
}
