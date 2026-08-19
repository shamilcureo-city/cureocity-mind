import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Container } from '@/components/ui/Container';
import { OnboardingForm } from '@/components/app/OnboardingForm';
import { requirePagePsychologist } from '@/lib/auth-page';
import { practitionerProductCopy, productFromHost } from '@/lib/product';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const product = productFromHost((await headers()).get('host'));
  const copy = practitionerProductCopy(product);
  return { title: copy.metadataTitle, description: copy.metadataDescription };
}

/**
 * Sprint 31 — onboarding gate.
 *
 * Uses `requirePagePsychologist` (NOT `requireOnboardedPsychologist`)
 * to avoid an infinite redirect: if the user is already onboarded we
 * bounce to /app explicitly.
 *
 * Three-products split: signing up on a product domain presets the
 * vertical (scribe → DOCTOR, mind → THERAPIST) — arriving via that
 * product's front door IS the choice. The toggle stays visible and
 * changeable; unknown hosts (previews, localhost) keep the explicit
 * must-pick behaviour.
 */
export default async function OnboardingPage() {
  const me = await requirePagePsychologist();
  if (me.onboardingCompletedAt !== null) redirect('/app');

  const host = (await headers()).get('host');
  const product = productFromHost(host);
  const copy = practitionerProductCopy(product);
  const presetVertical = host && host.split(':')[0] === product.host ? product.vertical : null;

  return (
    <main className="min-h-screen bg-[var(--color-bg)]">
      <Container className="py-12">
        <div className="mx-auto max-w-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
            Welcome
          </p>
          <h1 className="mt-2 font-serif text-4xl leading-tight">{copy.onboardingTitle}</h1>
          <p className="mt-3 text-sm text-[var(--color-ink-2)]">{copy.onboardingDescription}</p>

          <Card className="mt-8 p-7">
            <OnboardingForm phone={me.phone} presetVertical={presetVertical} />
          </Card>
        </div>
      </Container>
    </main>
  );
}
