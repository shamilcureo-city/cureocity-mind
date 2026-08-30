import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AuthedFetchProvider } from '@/components/app/AuthedFetchProvider';
import { MobileNav } from '@/components/app/MobileNav';
import { Sidebar, type PlanUsage } from '@/components/app/Sidebar';
import { HelpButton } from '@/components/app/HelpButton';
import { WelcomeOverlay } from '@/components/app/WelcomeOverlay';
import { LEARN_TOPICS, LEARN_GROUPS } from '@/lib/learn-content';
import { CLINICAL_GLOSSARY, type GlossaryEntry } from '@/lib/clinical-glossary';
import { currentPsychologist } from '@/lib/auth-page';
import { isAuthBypassed, sessionCookieDomain } from '@/lib/auth-server';
import { getEntitlement } from '@/lib/billing';
import { practitionerHostRedirect, practitionerProductCopy, productFromHost } from '@/lib/product';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const product = productFromHost((await headers()).get('host'));
  const copy = practitionerProductCopy(product);
  return { title: copy.metadataTitle, description: copy.metadataDescription };
}

/**
 * Authenticated scribe shell. Sidebar on md+, bottom tab bar on
 * phones. Page-level guards (`requireOnboardedPsychologist`) handle
 * the actual redirect to /login or /onboarding; the layout only
 * resolves the identity to feed the plan widget, and renders fine
 * when unauthenticated (the child page redirects before content
 * matters).
 *
 * Sprint 53 — the PlanUsage feed now comes from getEntitlement so the
 * cap is real (BillingAccount.trialSessionCap) and the widget flips
 * to "Solo · renews <date>" when the therapist is on a paid plan.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const psy = await currentPsychologist();
  const host = (await headers()).get('host');
  if (psy) {
    const canonicalUrl = practitionerHostRedirect(host, psy.vertical, sessionCookieDomain());
    if (canonicalUrl) redirect(canonicalUrl);
  }
  let usage: PlanUsage | null = null;
  if (psy) {
    const ent = await getEntitlement(psy.id);
    usage = {
      used: ent.trialUsed,
      cap: ent.trialCap,
      plan: ent.plan,
      paidThroughAt: ent.paidThroughAt,
    };
  }

  // Sprint 56 ops — warn loudly when the server is in auth-bypass on a
  // DEPLOYED env (Vercel). Bypass means every sign-in resolves to the
  // shared demo therapist; on local dev that's expected, so only flag it
  // on Vercel where it implies a real misconfiguration.
  const showBypassBanner = isAuthBypassed() && process.env['VERCEL'] === '1';

  // Sprint 61 — serializable help index for the floating "?" button:
  // every Learn topic + every glossary word, searchable from any screen.
  const helpTopics = LEARN_TOPICS.map((t) => ({
    slug: t.slug,
    title: t.title,
    lede: t.lede,
    groupTitle: LEARN_GROUPS.find((g) => g.key === t.group)?.title ?? '',
  }));
  const helpWords = Object.entries(CLINICAL_GLOSSARY).map(([key, raw]) => {
    const e: GlossaryEntry = raw;
    return { key, plainTitle: e.plainTitle, term: e.term, what: e.what };
  });

  return (
    <div className="app-wash relative flex min-h-screen flex-col">
      <AuthedFetchProvider />
      {showBypassBanner && (
        <div className="bg-[var(--color-warn-soft)] px-4 py-2 text-center text-xs text-[var(--color-warn)]">
          <strong>Demo mode</strong> — every sign-in resolves to the shared demo therapist. Set the
          server-side <code className="font-mono">FIREBASE_*</code> env vars and remove{' '}
          <code className="font-mono">AUTH_BYPASS</code> for real per-user accounts.{' '}
          <a href="/api/v1/health/auth" className="font-medium underline">
            Check auth status
          </a>
          .
        </div>
      )}
      <div className="flex flex-1">
        <Sidebar usage={usage} vertical={psy?.vertical ?? 'THERAPIST'} />
        <div className="flex flex-1 flex-col pb-16 md:pb-0">{children}</div>
        <MobileNav vertical={psy?.vertical ?? 'THERAPIST'} />
      </div>
      <HelpButton topics={helpTopics} words={helpWords} />
      {psy?.vertical === 'DOCTOR' && <WelcomeOverlay serverSeen={psy.hasSeenWelcome} />}
    </div>
  );
}
