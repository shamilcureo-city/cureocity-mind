import type { Metadata } from 'next';
import { CareIntentLanding } from '@/components/care/CareIntentLanding';

export const metadata: Metadata = {
  title: 'Months to the exam and your brain won’t cooperate — Cureocity Care',
  description:
    'Voice therapy for exam pressure — 25 minutes tonight, a plan by morning. In English, Hindi, or your mix. 2 free sessions a week. 18+.',
};

/** CG5 — the /care/exam-stress intent landing (colleges/18+ only — ethics ruling). */
export default function CareExamStressPage() {
  const signupsOpen = process.env['CARE_SIGNUPS_OPEN'] === 'true';
  return (
    <CareIntentLanding
      signupsOpen={signupsOpen}
      content={{
        hero: 'Months to the exam, and your brain won’t cooperate.',
        sub: 'Everyone says "bas focus karo." This listens instead — 25 minutes tonight, and a plan with small, doable steps by the time you sleep. For adults 18 and over.',
        points: [
          {
            title: 'Say it in your own words',
            body: 'The pressure, the comparisons, the guilt about wasted days — out loud, in English, Hindi, or the mix you actually think in. No forms.',
          },
          {
            title: 'A plan that fits around study',
            body: 'Goals you edit yourself and homework that takes two minutes — built to protect your prep, not compete with it.',
          },
          {
            title: 'Measured, honestly',
            body: 'Every few weeks, the same questionnaires clinicians use. Real change, or the honest opposite — and what to change if it isn’t working.',
          },
        ],
        cta: 'Take 25 minutes tonight — free',
      }}
    />
  );
}
