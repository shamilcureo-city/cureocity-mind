import { requireOnboardedTherapist } from '@/lib/auth-page';
import { prisma } from '@/lib/prisma';
import { Container } from '@/components/ui/Container';
import { MarketingStudio } from '@/components/app/MarketingStudio';
import { MarketingPosts } from '@/components/app/MarketingPosts';
import { profilePublishChecklist } from '@/lib/marketing';
import { parseFaqs } from '@/lib/public-profile';

export const dynamic = 'force-dynamic';

/**
 * Marketing V1 — the therapist's marketing studio: publish state +
 * checklist, public URL, weekly availability, FAQs, and the
 * appointment inbox. Profile FIELDS (headline, bio, photo, fees…) are
 * edited on Settings → Account; the studio links there rather than
 * duplicating that form.
 */
export default async function MarketingPage() {
  const therapist = await requireOnboardedTherapist();

  const ruleRows = await prisma.availabilityRule.findMany({
    where: { psychologistId: therapist.id },
    select: { weekday: true, startMinute: true, endMinute: true, slotMinutes: true, mode: true },
    orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }],
  });
  const photo = await prisma.psychologistPhoto.findUnique({
    where: { psychologistId: therapist.id },
    select: { updatedAt: true },
  });
  // The DB stores plain Int; the contract narrows to the offered lengths.
  const rules = ruleRows.map((r) => ({
    ...r,
    slotMinutes: r.slotMinutes as 30 | 45 | 60 | 90,
    mode: (r.mode === 'IN_PERSON' ? 'IN_PERSON' : 'ONLINE') as 'ONLINE' | 'IN_PERSON',
  }));

  const checklist = profilePublishChecklist(therapist);

  return (
    <Container className="py-10">
      <header>
        <h1 className="font-serif text-3xl">Marketing</h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--color-ink-2)]">
          Your public page on the Cureocity directory — get found by clients, take appointment
          requests, and turn them into scheduled intakes with one tap.
        </p>
      </header>
      <div className="mt-8">
        <MarketingStudio
          initialState={{
            publicSlug: therapist.publicSlug,
            publishedAt: therapist.profilePublishedAt?.toISOString() ?? null,
            faqs: parseFaqs(therapist.profileFaqs),
            checklist,
            publicUrl:
              therapist.profilePublishedAt && therapist.publicSlug
                ? `/therapists/${therapist.publicSlug}`
                : null,
          }}
          initialRules={rules}
          initialIdentity={{
            credentialsLine: therapist.credentialsLine,
            pronouns: therapist.pronouns,
            officeAddress: therapist.officeAddress,
            hasPhoto: photo !== null,
          }}
        />
        <div className="mt-6">
          <MarketingPosts profileSlug={therapist.publicSlug} />
        </div>
      </div>
    </Container>
  );
}
