import { prisma } from '@/lib/prisma';
import { ProfileFaqSchema, type ProfileFaq } from '@cureocity/contracts';
import { computeSlots, type BusyInterval, type WeeklyRule } from '@/lib/marketing';

/**
 * Marketing V1 — server-side loaders for the PUBLIC therapist surface
 * (/therapists directory + /therapists/[slug] profile + slot feed).
 *
 * Everything here serves anonymous traffic, so the select lists are
 * explicit allow-lists: no email, no phone, no RCI number, no internal
 * state ever crosses this boundary. Only PUBLISHED therapist profiles
 * resolve.
 */

export const DIRECTORY_SELECT = {
  id: true,
  publicSlug: true,
  fullName: true,
  headline: true,
  photoUrl: true,
  specialties: true,
  languages: true,
  modalities: true,
  yearsOfExperience: true,
  locationCity: true,
  locationProvince: true,
  sessionFeeInr: true,
  isAcceptingNewClients: true,
} as const;

export interface DirectoryRow {
  id: string;
  publicSlug: string | null;
  fullName: string;
  headline: string | null;
  photoUrl: string | null;
  specialties: string[];
  languages: string[];
  modalities: string[];
  yearsOfExperience: number | null;
  locationCity: string | null;
  locationProvince: string | null;
  sessionFeeInr: number | null;
  isAcceptingNewClients: boolean;
}

export interface DirectoryFilters {
  specialty?: string;
  language?: string;
  city?: string;
  q?: string;
}

const PUBLISHED_WHERE = {
  deletedAt: null,
  vertical: 'THERAPIST' as const,
  profilePublishedAt: { not: null },
  publicSlug: { not: null },
};

/** Published therapists for the directory, newest first. */
export async function fetchDirectory(filters: DirectoryFilters = {}): Promise<DirectoryRow[]> {
  return prisma.psychologist.findMany({
    where: {
      ...PUBLISHED_WHERE,
      ...(filters.specialty ? { specialties: { has: filters.specialty } } : {}),
      ...(filters.language ? { languages: { has: filters.language } } : {}),
      ...(filters.city ? { locationCity: { equals: filters.city, mode: 'insensitive' } } : {}),
      ...(filters.q ? { fullName: { contains: filters.q, mode: 'insensitive' } } : {}),
    },
    orderBy: { profilePublishedAt: 'desc' },
    take: 100,
    select: DIRECTORY_SELECT,
  });
}

export interface PublicProfile extends DirectoryRow {
  id: string;
  bio: string | null;
  faqs: ProfileFaq[];
  credentialsLine: string | null;
  pronouns: string | null;
  officeAddress: string | null;
}

/** One published profile by slug — null when unknown or unpublished. */
export async function loadPublishedTherapist(slug: string): Promise<PublicProfile | null> {
  const row = await prisma.psychologist.findFirst({
    where: { ...PUBLISHED_WHERE, publicSlug: slug },
    select: {
      ...DIRECTORY_SELECT,
      id: true,
      bio: true,
      profileFaqs: true,
      credentialsLine: true,
      pronouns: true,
      officeAddress: true,
    },
  });
  if (!row) return null;
  return withInlinePhoto(toPublicProfile(row));
}

function toPublicProfile(row: {
  id: string;
  bio: string | null;
  profileFaqs: unknown;
  credentialsLine: string | null;
  pronouns: string | null;
  officeAddress: string | null;
  publicSlug: string | null;
  fullName: string;
  headline: string | null;
  photoUrl: string | null;
  specialties: string[];
  languages: string[];
  modalities: string[];
  yearsOfExperience: number | null;
  locationCity: string | null;
  locationProvince: string | null;
  sessionFeeInr: number | null;
  isAcceptingNewClients: boolean;
}): PublicProfile {
  const { profileFaqs, ...rest } = row;
  return { ...rest, faqs: parseFaqs(profileFaqs) };
}

/** An uploaded inline photo wins over any external photoUrl. */
async function withInlinePhoto(profile: PublicProfile): Promise<PublicProfile> {
  const photo = await prisma.psychologistPhoto.findUnique({
    where: { psychologistId: profile.id },
    select: { updatedAt: true },
  });
  if (!photo) return profile;
  return {
    ...profile,
    photoUrl: `/api/v1/public/therapists/${profile.publicSlug}/photo?v=${photo.updatedAt.getTime()}`,
  };
}

/**
 * MK2 — the therapist's own page BEFORE publish. Only the owner ever
 * receives this (the caller must pass the authenticated psychologist's
 * own id); it renders with a preview banner.
 */
export async function loadOwnProfilePreview(
  slug: string,
  ownerId: string,
): Promise<PublicProfile | null> {
  const row = await prisma.psychologist.findFirst({
    where: { id: ownerId, publicSlug: slug, deletedAt: null, vertical: 'THERAPIST' },
    select: {
      ...DIRECTORY_SELECT,
      id: true,
      bio: true,
      profileFaqs: true,
      credentialsLine: true,
      pronouns: true,
      officeAddress: true,
    },
  });
  if (!row) return null;
  return withInlinePhoto(toPublicProfile(row));
}

/** Defensive parse — malformed stored JSON renders as no FAQs, never a 500. */
export function parseFaqs(raw: unknown): ProfileFaq[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const parsed = ProfileFaqSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}

/** The therapist's weekly bookable windows. */
export async function loadWeeklyRules(psychologistId: string): Promise<WeeklyRule[]> {
  const rows = await prisma.availabilityRule.findMany({
    where: { psychologistId },
    select: { weekday: true, startMinute: true, endMinute: true, slotMinutes: true, mode: true },
    orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }],
  });
  return rows;
}

/**
 * MK2 — "Next slot: today 5 pm" for directory cards. Batch: three
 * queries for the whole page, slots derived in-process. Returns a map
 * psychologistId → next offered slot ISO (or nothing when none).
 */
export async function nextSlotByTherapist(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const now = new Date();
  const to = new Date(now.getTime() + 7 * 24 * 60 * 60_000);
  const [allRules, appts, sessions] = await Promise.all([
    prisma.availabilityRule.findMany({
      where: { psychologistId: { in: ids } },
      select: {
        psychologistId: true,
        weekday: true,
        startMinute: true,
        endMinute: true,
        slotMinutes: true,
        mode: true,
      },
    }),
    prisma.appointment.findMany({
      where: {
        psychologistId: { in: ids },
        status: { in: ['REQUESTED', 'CONFIRMED'] },
        startAt: { lt: to },
        endAt: { gt: now },
      },
      select: { psychologistId: true, startAt: true, endAt: true },
    }),
    prisma.session.findMany({
      where: {
        psychologistId: { in: ids },
        status: 'SCHEDULED',
        scheduledAt: { gte: new Date(now.getTime() - SESSION_BLOCK_MINUTES * 60_000), lt: to },
      },
      select: { psychologistId: true, scheduledAt: true },
    }),
  ]);
  const rulesBy = new Map<string, WeeklyRule[]>();
  for (const r of allRules) {
    rulesBy.set(r.psychologistId, [...(rulesBy.get(r.psychologistId) ?? []), r]);
  }
  const busyBy = new Map<string, BusyInterval[]>();
  for (const a of appts) {
    busyBy.set(a.psychologistId, [
      ...(busyBy.get(a.psychologistId) ?? []),
      { startAt: a.startAt, endAt: a.endAt },
    ]);
  }
  for (const s of sessions) {
    busyBy.set(s.psychologistId, [
      ...(busyBy.get(s.psychologistId) ?? []),
      {
        startAt: s.scheduledAt,
        endAt: new Date(s.scheduledAt.getTime() + SESSION_BLOCK_MINUTES * 60_000),
      },
    ]);
  }
  for (const id of ids) {
    const rules = rulesBy.get(id);
    if (!rules?.length) continue;
    const slots = computeSlots(rules, busyBy.get(id) ?? [], now, 7);
    if (slots[0]) out.set(id, slots[0].startAt);
  }
  return out;
}

/** How long a SCHEDULED session blocks the calendar (no duration column). */
export const SESSION_BLOCK_MINUTES = 60;

/**
 * Everything that makes a slot un-offerable in [from, to): held or
 * confirmed appointments plus the therapist's own scheduled sessions.
 * Sessions have no duration column; they block SESSION_BLOCK_MINUTES.
 */
export async function loadBusyIntervals(
  psychologistId: string,
  from: Date,
  to: Date,
): Promise<BusyInterval[]> {
  const [appointments, sessions] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        psychologistId,
        status: { in: ['REQUESTED', 'CONFIRMED'] },
        startAt: { lt: to },
        endAt: { gt: from },
      },
      select: { startAt: true, endAt: true },
    }),
    prisma.session.findMany({
      where: {
        psychologistId,
        status: 'SCHEDULED',
        scheduledAt: { gte: new Date(from.getTime() - SESSION_BLOCK_MINUTES * 60_000), lt: to },
      },
      select: { scheduledAt: true },
    }),
  ]);
  return [
    ...appointments,
    ...sessions.map((s) => ({
      startAt: s.scheduledAt,
      endAt: new Date(s.scheduledAt.getTime() + SESSION_BLOCK_MINUTES * 60_000),
    })),
  ];
}

/** MK5 — published posts for a profile page (newest first). */
export async function loadPublishedPosts(
  psychologistId: string,
  limit = 10,
): Promise<{ slug: string; title: string; publishedAt: Date | null }[]> {
  return prisma.profilePost.findMany({
    where: { psychologistId, status: 'PUBLISHED' },
    orderBy: { publishedAt: 'desc' },
    take: limit,
    select: { slug: true, title: true, publishedAt: true },
  });
}

/** MK5 — one published post by profile slug + post slug. */
export async function loadPublishedPost(
  profileSlug: string,
  postSlug: string,
): Promise<{
  therapist: PublicProfile;
  post: { slug: string; title: string; body: string; publishedAt: Date | null };
} | null> {
  const therapist = await loadPublishedTherapist(profileSlug);
  if (!therapist) return null;
  const post = await prisma.profilePost.findFirst({
    where: { psychologistId: therapist.id, slug: postSlug, status: 'PUBLISHED' },
    select: { slug: true, title: true, body: true, publishedAt: true },
  });
  if (!post) return null;
  return { therapist, post };
}
