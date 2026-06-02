import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { Container } from '@/components/ui/Container';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/therapist/Avatar';
import { BookingForm } from '@/components/therapist/BookingForm';
import { fetchPublicTherapistById } from '@/lib/directory';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function TherapistProfilePage({ params }: PageProps) {
  const { id } = await params;
  const t = await fetchPublicTherapistById(id);
  if (!t) notFound();

  const location = [t.locationCity, t.locationProvince].filter(Boolean).join(', ');

  return (
    <>
      <Header />
      <main className="pb-24">
        <Container className="pt-10">
          <Link
            href="/therapists"
            className="text-sm text-[var(--color-ink-3)] hover:text-[var(--color-ink)]"
          >
            ← Back to directory
          </Link>

          <div className="mt-8 grid gap-12 lg:grid-cols-[1.4fr_1fr]">
            <article>
              <header className="flex items-start gap-6">
                <Avatar name={t.fullName} size={96} />
                <div className="min-w-0">
                  <h1 className="font-serif text-4xl leading-tight">{t.fullName}</h1>
                  {t.headline && (
                    <p className="mt-2 text-lg text-[var(--color-ink-2)]">{t.headline}</p>
                  )}
                  <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-[var(--color-ink-3)]">
                    {location && <span>{location}</span>}
                    {location && t.yearsOfExperience !== null && <span aria-hidden>·</span>}
                    {t.yearsOfExperience !== null && (
                      <span>{t.yearsOfExperience}+ years of experience</span>
                    )}
                    {!t.isAcceptingNewClients && (
                      <Badge tone="warn" className="ml-1">
                        Waitlist
                      </Badge>
                    )}
                  </div>
                </div>
              </header>

              {t.bio && (
                <section className="mt-10">
                  <h2 className="font-serif text-2xl">About</h2>
                  <p className="mt-3 whitespace-pre-line text-[15px] leading-relaxed text-[var(--color-ink-2)]">
                    {t.bio}
                  </p>
                </section>
              )}

              <Section title="Specialties" items={t.specialties} tone="accent" />
              <Section title="Approaches" items={t.modalities} tone="default" />
              <Section title="Languages" items={t.languages} tone="muted" />

              <section className="mt-10 rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-6">
                <h2 className="font-serif text-xl">Fees</h2>
                <p className="mt-2 text-[15px] text-[var(--color-ink-2)]">
                  {t.sessionFeeInr === null
                    ? 'This therapist offers a sliding-scale fee — discussed on the intro call.'
                    : `₹${t.sessionFeeInr.toLocaleString('en-IN')} per 50-minute session.`}
                </p>
                <p className="mt-2 text-sm text-[var(--color-ink-3)]">
                  The first 15-minute introductory call is free.
                </p>
              </section>
            </article>

            <aside className="lg:sticky lg:top-24 lg:self-start">
              <div className="rounded-2xl border border-[var(--color-line)] bg-white p-6 shadow-[0_24px_60px_-32px_rgba(15,27,42,0.18)]">
                <h2 className="font-serif text-2xl">Request a call</h2>
                <p className="mt-1 text-sm text-[var(--color-ink-2)]">
                  Tell {t.fullName.split(' ')[0]} a bit about you and pick a time.
                </p>
                <div className="mt-6">
                  <BookingForm therapistId={t.id} therapistName={t.fullName} />
                </div>
              </div>
            </aside>
          </div>
        </Container>
      </main>
      <Footer />
    </>
  );
}

function Section({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: 'accent' | 'default' | 'muted';
}) {
  if (items.length === 0) return null;
  return (
    <section className="mt-8">
      <h2 className="font-serif text-2xl">{title}</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        {items.map((it) => (
          <Badge key={it} tone={tone}>
            {it}
          </Badge>
        ))}
      </div>
    </section>
  );
}
