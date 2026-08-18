import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Container } from '@/components/ui/Container';
import { PublicAvatar } from '@/components/public/Avatar';
import { loadPublishedPost } from '@/lib/public-profile';
import { serializeJsonForHtml } from '@/lib/html-safe-json';

export const dynamic = 'force-dynamic';

/**
 * MK5 — a published profile post. PUBLIC; Article JSON-LD so the piece
 * is citable by search engines and AI assistants — each post is another
 * reason for them to surface this therapist.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; postSlug: string }>;
}): Promise<Metadata> {
  const { slug, postSlug } = await params;
  const found = await loadPublishedPost(slug, postSlug);
  if (!found) return { title: 'Cureocity' };
  return {
    title: `${found.post.title} — ${found.therapist.fullName} | Cureocity`,
    description: found.post.body.slice(0, 160),
  };
}

export default async function ProfilePostPage({
  params,
}: {
  params: Promise<{ slug: string; postSlug: string }>;
}) {
  const { slug, postSlug } = await params;
  const found = await loadPublishedPost(slug, postSlug);
  if (!found) notFound();
  const { therapist, post } = found;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    author: { '@type': 'Person', name: therapist.fullName },
    ...(post.publishedAt && { datePublished: post.publishedAt.toISOString() }),
  };

  return (
    <main className="min-h-screen bg-[var(--color-bg)]">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonForHtml(jsonLd) }}
      />
      <Container className="max-w-3xl py-14">
        <Link
          href={`/therapists/${slug}`}
          className="text-sm text-[var(--color-ink-3)] hover:text-[var(--color-accent)]"
        >
          ← {therapist.fullName}
        </Link>
        <h1 className="mt-4 font-serif text-3xl leading-tight">{post.title}</h1>
        <div className="mt-4 flex items-center gap-3 border-b border-[var(--color-line-soft)] pb-6">
          <PublicAvatar name={therapist.fullName} photoUrl={therapist.photoUrl} size={36} />
          <div className="text-sm text-[var(--color-ink-2)]">
            <Link
              href={`/therapists/${slug}`}
              className="font-medium text-[var(--color-ink)] hover:underline"
            >
              {therapist.fullName}
            </Link>
            {post.publishedAt && (
              <span className="ml-2 text-[var(--color-ink-3)]">
                {post.publishedAt.toLocaleDateString('en-IN', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              </span>
            )}
          </div>
        </div>
        <div className="mt-8 space-y-5 text-[15px] leading-relaxed text-[var(--color-ink-2)]">
          {post.body.split(/\n{2,}/).map((para, i) => (
            <p key={i} className="whitespace-pre-line">
              {para}
            </p>
          ))}
        </div>
        <div className="mt-12 rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] p-6">
          <p className="text-sm text-[var(--color-ink-2)]">
            If this feels familiar, {therapist.fullName} works with exactly this.
          </p>
          <Link
            href={`/therapists/${slug}`}
            className="mt-2 inline-block text-sm font-medium text-[var(--color-accent)] hover:underline"
          >
            See available times →
          </Link>
        </div>
      </Container>
    </main>
  );
}
