import type { MetadataRoute } from 'next';
import { prisma } from '@/lib/prisma';

/**
 * MK5 — sitemap for the public therapist surface. Served on every host
 * (search engines fetch per-domain); entries canonicalise on the mind
 * host where the directory lives.
 *
 * force-dynamic: the entries come from the DB, which doesn't exist at
 * build time — and a DB hiccup degrades to the static directory entry
 * rather than a 500 (crawlers retry).
 */
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env['NEXT_PUBLIC_APP_URL'] ?? 'https://mind.cureocity.in';
  try {
    return await buildEntries(base);
  } catch (e) {
    console.warn(`[sitemap] degraded to static entries: ${(e as Error).message}`);
    return [{ url: `${base}/therapists`, changeFrequency: 'daily', priority: 0.9 }];
  }
}

async function buildEntries(base: string): Promise<MetadataRoute.Sitemap> {
  const therapists = await prisma.psychologist.findMany({
    where: {
      deletedAt: null,
      vertical: 'THERAPIST',
      profilePublishedAt: { not: null },
      publicSlug: { not: null },
    },
    select: { publicSlug: true, updatedAt: true, id: true, locationCity: true, specialties: true },
  });
  const posts = await prisma.profilePost.findMany({
    where: { status: 'PUBLISHED', psychologistId: { in: therapists.map((t) => t.id) } },
    select: { slug: true, publishedAt: true, psychologistId: true },
  });
  const slugById = new Map(therapists.map((t) => [t.id, t.publicSlug]));

  const cities = [...new Set(therapists.map((t) => t.locationCity).filter(Boolean))] as string[];
  const specialties = [...new Set(therapists.flatMap((t) => t.specialties))];

  return [
    { url: `${base}/therapists`, changeFrequency: 'daily', priority: 0.9 },
    ...cities.map((c) => ({
      url: `${base}/therapists/in/${encodeURIComponent(c.toLowerCase())}`,
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    })),
    ...specialties.map((s) => ({
      url: `${base}/therapists/for/${encodeURIComponent(s.toLowerCase())}`,
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    })),
    ...therapists.map((t) => ({
      url: `${base}/therapists/${t.publicSlug}`,
      lastModified: t.updatedAt,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),
    ...posts.flatMap((p) => {
      const slug = slugById.get(p.psychologistId);
      if (!slug) return [];
      return [
        {
          url: `${base}/therapists/${slug}/posts/${p.slug}`,
          ...(p.publishedAt && { lastModified: p.publishedAt }),
          changeFrequency: 'monthly' as const,
          priority: 0.6,
        },
      ];
    }),
  ];
}
