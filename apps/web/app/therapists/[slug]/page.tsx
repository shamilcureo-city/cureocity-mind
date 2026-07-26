import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Container } from '@/components/ui/Container';
import { Badge } from '@/components/ui/Badge';
import { PublicAvatar } from '@/components/public/Avatar';
import { AppointmentWidget } from '@/components/public/AppointmentWidget';
import { languageName } from '@/components/public/TherapistCard';
import { loadPublishedTherapist } from '@/lib/public-profile';

export const dynamic = 'force-dynamic';

/**
 * Marketing V1 — a therapist's PUBLIC profile page. Anonymous traffic;
 * resolves only published profiles by slug. Emits Person + FAQPage
 * JSON-LD so search engines and AI assistants can cite the page — the
 * discoverability half of the feature.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const t = await loadPublishedTherapist(slug);
  if (!t) return { title: 'Therapist — Cureocity' };
  const where = t.locationCity ? ` in ${t.locationCity}` : '';
  return {
    title: `${t.fullName} — Therapist${where} | Cureocity`,
    description: t.headline ?? t.bio?.slice(0, 160) ?? undefined,
  };
}

export default async function TherapistProfilePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const t = await loadPublishedTherapist(slug);
  if (!t) notFound();

  const location = [t.locationCity, t.locationProvince].filter(Boolean).join(', ');

  const jsonLd: Record<string, unknown>[] = [
    {
      '@context': 'https://schema.org',
      '@type': 'Person',
      name: t.fullName,
      jobTitle: 'Psychologist',
      description: t.headline ?? undefined,
      knowsLanguage: t.languages.map(languageName),
      ...(location && { address: { '@type': 'PostalAddress', addressLocality: location } }),
      ...(t.photoUrl && { image: t.photoUrl }),
    },
  ];
  if (t.faqs.length > 0) {
    jsonLd.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: t.faqs.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    });
  }

  return (
    <main className="min-h-screen bg-[var(--color-bg)]">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Container className="py-14">
        <Link
          href="/therapists"
          className="text-sm text-[var(--color-ink-3)] hover:text-[var(--color-accent)]"
        >
          ← All therapists
        </Link>

        <div className="mt-6 grid gap-10 lg:grid-cols-[1fr_380px]">
          <div>
            <header className="flex items-start gap-5">
              <PublicAvatar name={t.fullName} photoUrl={t.photoUrl} size={88} />
              <div>
                <h1 className="font-serif text-3xl">{t.fullName}</h1>
                {t.headline && <p className="mt-1 text-[var(--color-ink-2)]">{t.headline}</p>}
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[var(--color-ink-2)]">
                  {location && <span>{location}</span>}
                  {t.yearsOfExperience !== null && (
                    <span>{t.yearsOfExperience} yrs experience</span>
                  )}
                  {t.languages.length > 0 && (
                    <span>{t.languages.map(languageName).join(' · ')}</span>
                  )}
                  <Badge tone="accent">RCI-verified</Badge>
                </div>
              </div>
            </header>

            {t.bio && (
              <section className="mt-10">
                <h2 className="font-serif text-xl">About</h2>
                <p className="mt-3 whitespace-pre-line text-[15px] leading-relaxed text-[var(--color-ink-2)]">
                  {t.bio}
                </p>
              </section>
            )}

            {(t.specialties.length > 0 || t.modalities.length > 0) && (
              <section className="mt-10">
                <h2 className="font-serif text-xl">Practice</h2>
                {t.specialties.length > 0 && (
                  <div className="mt-3">
                    <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-3)]">
                      Works with
                    </h3>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {t.specialties.map((s) => (
                        <Badge key={s} tone="accent">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                {t.modalities.length > 0 && (
                  <div className="mt-4">
                    <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-3)]">
                      Approaches
                    </h3>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {t.modalities.map((m) => (
                        <Badge key={m} tone="muted">
                          {m}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            )}

            {t.faqs.length > 0 && (
              <section className="mt-10">
                <h2 className="font-serif text-xl">Frequently asked questions</h2>
                <dl className="mt-4 space-y-5">
                  {t.faqs.map((f, i) => (
                    <div key={i}>
                      <dt className="font-medium">{f.q}</dt>
                      <dd className="mt-1 text-[15px] leading-relaxed text-[var(--color-ink-2)]">
                        {f.a}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}
          </div>

          <aside>
            <div className="sticky top-8 rounded-3xl border border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] p-6">
              <h2 className="font-serif text-xl">Book a session</h2>
              {t.sessionFeeInr !== null && (
                <p className="mt-1 text-sm text-[var(--color-ink-2)]">
                  ₹{t.sessionFeeInr.toLocaleString('en-IN')} per session
                </p>
              )}
              <div className="mt-5">
                <AppointmentWidget
                  slug={slug}
                  therapistName={t.fullName}
                  acceptingNewClients={t.isAcceptingNewClients}
                />
              </div>
            </div>
          </aside>
        </div>
      </Container>
    </main>
  );
}
