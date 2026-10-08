import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Container } from '@/components/ui/Container';
import { OnboardingForm } from '@/components/app/OnboardingForm';
import { AuthedFetchProvider } from '@/components/app/AuthedFetchProvider';
import { requireOnboardingPagePsychologist } from '@/lib/auth-page';
import { isAuthBypassed } from '@/lib/auth-server';
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
 * Uses a profile-only guard: incomplete pending Scribe accounts may submit
 * registration, but remain blocked from clinical pages. Mind keeps its
 * active-account requirement. Completed accounts bounce to /app.
 *
 * Three-products split: signing up on a product domain presets the
 * vertical (scribe → DOCTOR, mind → THERAPIST) — arriving via that
 * product's front door IS the choice. The toggle stays visible and
 * changeable; unknown hosts (previews, localhost) keep the explicit
 * must-pick behaviour.
 */
export default async function OnboardingPage() {
  // Match the onboarding API's existing lifecycle restriction. Do not offer
  // a form which will inevitably fail with an inactive-account error.
  const host = (await headers()).get('host');
  const product = productFromHost(host);
  const me = await requireOnboardingPagePsychologist(product.key === 'scribe');
  if (me.onboardingCompletedAt !== null) redirect('/app');
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
            <AuthedFetchProvider expectedUid={isAuthBypassed() ? null : me.firebaseUid}>
              <OnboardingForm
                phone={me.phone}
                presetVertical={presetVertical}
                initialFullName={me.fullName}
                initialEmail={me.email}
                awaitingApproval={me.status === 'PENDING_VERIFICATION'}
              />
            </AuthedFetchProvider>
          </Card>
        </div>
      </Container>
    </main>
  );
}
