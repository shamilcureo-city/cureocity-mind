import { prisma } from './prisma';
import type { TherapistSummary } from '@/components/therapist/TherapistCard';

export interface DirectoryFilters {
  specialty?: string;
  language?: string;
  modality?: string;
  city?: string;
  acceptingOnly?: boolean;
}

const PUBLIC_SELECT = {
  id: true,
  fullName: true,
  headline: true,
  bio: true,
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

export async function fetchPublicTherapists(
  filters: DirectoryFilters = {},
  limit = 50,
): Promise<TherapistSummary[]> {
  const rows = await prisma.psychologist.findMany({
    where: {
      deletedAt: null,
      status: 'ACTIVE',
      bio: { not: null },
      ...(filters.specialty ? { specialties: { has: filters.specialty } } : {}),
      ...(filters.language ? { languages: { has: filters.language } } : {}),
      ...(filters.modality ? { modalities: { has: filters.modality } } : {}),
      ...(filters.city ? { locationCity: { equals: filters.city, mode: 'insensitive' } } : {}),
      ...(filters.acceptingOnly ? { isAcceptingNewClients: true } : {}),
    },
    select: PUBLIC_SELECT,
    orderBy: [
      { isAcceptingNewClients: 'desc' },
      { yearsOfExperience: 'desc' },
      { fullName: 'asc' },
    ],
    take: limit,
  });
  return rows.map(toSummary);
}

export interface TherapistProfile extends TherapistSummary {
  bio: string | null;
  modalities: string[];
}

export async function fetchPublicTherapistById(id: string): Promise<TherapistProfile | null> {
  const row = await prisma.psychologist.findFirst({
    where: { id, deletedAt: null, status: 'ACTIVE', bio: { not: null } },
    select: PUBLIC_SELECT,
  });
  if (!row) return null;
  return { ...toSummary(row), bio: row.bio, modalities: row.modalities };
}

export async function fetchAllFilterFacets(): Promise<{
  specialties: string[];
  languages: string[];
  modalities: string[];
  cities: string[];
}> {
  const rows = await prisma.psychologist.findMany({
    where: { deletedAt: null, status: 'ACTIVE', bio: { not: null } },
    select: { specialties: true, languages: true, modalities: true, locationCity: true },
  });
  const sets = {
    specialties: new Set<string>(),
    languages: new Set<string>(),
    modalities: new Set<string>(),
    cities: new Set<string>(),
  };
  for (const r of rows) {
    r.specialties.forEach((s) => sets.specialties.add(s));
    r.languages.forEach((s) => sets.languages.add(s));
    r.modalities.forEach((s) => sets.modalities.add(s));
    if (r.locationCity) sets.cities.add(r.locationCity);
  }
  return {
    specialties: [...sets.specialties].sort(),
    languages: [...sets.languages].sort(),
    modalities: [...sets.modalities].sort(),
    cities: [...sets.cities].sort(),
  };
}

function toSummary(row: {
  id: string;
  fullName: string;
  headline: string | null;
  specialties: string[];
  languages: string[];
  modalities: string[];
  yearsOfExperience: number | null;
  locationCity: string | null;
  locationProvince: string | null;
  sessionFeeInr: number | null;
  isAcceptingNewClients: boolean;
}): TherapistSummary {
  return {
    id: row.id,
    fullName: row.fullName,
    headline: row.headline,
    specialties: row.specialties,
    languages: row.languages,
    locationCity: row.locationCity,
    locationProvince: row.locationProvince,
    sessionFeeInr: row.sessionFeeInr,
    yearsOfExperience: row.yearsOfExperience,
    isAcceptingNewClients: row.isAcceptingNewClients,
  };
}
