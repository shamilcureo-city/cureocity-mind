import { requireOnboardedTherapist } from '@/lib/auth-page';
import { prisma } from '@/lib/prisma';
import { getEntitlement } from '@/lib/billing';
import { Container } from '@/components/ui/Container';
import { MarketingStudio } from '@/components/app/MarketingStudio';
import { profilePublishChecklist } from '@/lib/marketing';
import { parseFaqs } from '@/lib/public-profile';

export const dynamic = 'force-dynamic';

/**
 * Marketing studio (MK7 restructure) — one page, four tabs, Klarify-
 * shaped: **My page** edits the public page section-by-section in the
 * same order visitors see it; **My content** holds the paid-plan blog;
 * **Inquiries** is the appointment inbox; **Stats** the funnel.
 */
export default async function MarketingPage() {
  const therapist = await requireOnboardedTherapist();

  const [ruleRows, photo, entitlement] = await Promise.all([
    prisma.availabilityRule.findMany({
      where: { psychologistId: therapist.id },
      select: { weekday: true, startMinute: true, endMinute: true, slotMinutes: true, mode: true },
      orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }],
    }),
    prisma.psychologistPhoto.findUnique({
      where: { psychologistId: therapist.id },
      select: { updatedAt: true },
    }),
    getEntitlement(therapist.id),
  ]);
  // The DB stores plain Int; the contract narrows to the offered lengths.
  const rules = ruleRows.map((r) => ({
    ...r,
    slotMinutes: r.slotMinutes as 30 | 45 | 60 | 90,
    mode: (r.mode === 'IN_PERSON' ? 'IN_PERSON' : 'ONLINE') as 'ONLINE' | 'IN_PERSON',
  }));

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
            checklist: profilePublishChecklist(therapist),
            publicUrl:
              therapist.profilePublishedAt && therapist.publicSlug
                ? `/therapists/${therapist.publicSlug}`
                : null,
          }}
          initialRules={rules}
          initialProfile={{
            headline: therapist.headline,
            bio: therapist.bio,
            locationCity: therapist.locationCity,
            locationProvince: therapist.locationProvince,
            specialties: therapist.specialties,
            languages: therapist.languages,
            modalities: therapist.modalities,
            yearsOfExperience: therapist.yearsOfExperience,
            sessionFeeInr: therapist.sessionFeeInr,
            isAcceptingNewClients: therapist.isAcceptingNewClients,
            credentialsLine: therapist.credentialsLine,
            pronouns: therapist.pronouns,
            officeAddress: therapist.officeAddress,
            videoCallLink: therapist.videoCallLink,
            hasPhoto: photo !== null,
          }}
          contentEntitled={entitlement.plan !== 'FREE_TRIAL'}
        />
      </div>
    </Container>
  );
}
