import type { Metadata } from 'next';
import { crisisResources } from '@/lib/care-safety';
import { CareAnonymousCheck } from '@/components/care/CareAnonymousCheck';

export const metadata: Metadata = {
  title: 'How heavy is it, really? A 2-minute check — Cureocity Care',
  description:
    'The same 2-minute check-in clinicians use (PHQ-9). No sign-up. Nothing stored. A straight answer, in plain words.',
};

/**
 * CG5 — /care/check, the anonymous top-of-funnel (docs/CARE_GROWTH_SYSTEM.md §8).
 * The probe stigma allows: checking is not admitting. Reuses the validated
 * PHQ-9 registry client-side; NOTHING is persisted for anonymous visitors;
 * item-9 or a severe band shows crisis resources inline, unauthenticated,
 * never gated behind signup. The score rides into intake only with the
 * user's explicit consent at the CTA.
 */
export default function CareCheckPage() {
  const signupsOpen = process.env['CARE_SIGNUPS_OPEN'] === 'true';
  return <CareAnonymousCheck resources={crisisResources(['en', 'hi'])} signupsOpen={signupsOpen} />;
}
