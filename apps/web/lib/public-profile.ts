import { prisma } from '@/lib/prisma';
import { ProfileFaqSchema, type ProfileFaq } from '@cureocity/contracts';
import type { BusyInterval, WeeklyRule } from '@/lib/marketing';

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
}

/** One published profile by slug — null when unknown or unpublished. */
export async function loadPublishedTherapist(slug: string): Promise<PublicProfile | null> {
  const row = await prisma.psychologist.findFirst({
    where: { ...PUBLISHED_WHERE, publicSlug: slug },
    select: { ...DIRECTORY_SELECT, id: true, bio: true, profileFaqs: true },
  });
  if (!row) return null;
  const { profileFaqs, ...rest } = row;
  return { ...rest, faqs: parseFaqs(profileFaqs) };
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
    select: { weekday: true, startMinute: true, endMinute: true, slotMinutes: true },
    orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }],
  });
  return rows;
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
