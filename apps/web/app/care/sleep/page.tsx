import type { Metadata } from 'next';
import { CareIntentLanding } from '@/components/care/CareIntentLanding';

export const metadata: Metadata = {
  title: "It's 1:40am again. Your therapist is awake. — Cureocity Care",
  description:
    'Voice therapy for the nights your brain won’t switch off — in English, Hindi, Malayalam, or your mix. 2 free sessions a week.',
};

/** CG5 — the /care/sleep intent landing (docs/CARE_GROWTH_SYSTEM.md §8). */
export default function CareSleepPage() {
  const signupsOpen = process.env['CARE_SIGNUPS_OPEN'] === 'true';
  return (
    <CareIntentLanding
      signupsOpen={signupsOpen}
      content={{
        hero: "It's 1:40am again. Your therapist is awake.",
        sub: 'The 2am mind is loud, and everyone you could call is asleep. Talking helps more than scrolling — a real voice session, tonight, in your language.',
        points: [
          {
            title: 'A real session, not sleep hygiene tips',
            body: 'A 25–30 minute voice conversation about what actually keeps you up — and a written plan afterwards, with one small thing to try this week.',
          },
          {
            title: 'A sleep-specific track',
            body: 'If sleep is the heart of it, your plan works a dedicated track: the wind-down, the 2am thoughts, the wake time — one change at a time, measured honestly.',
          },
          {
            title: 'Whenever it is for you',
            body: 'Most people start after 10pm. That is fine — she is awake.',
          },
        ],
        cta: 'Talk it through tonight — free',
      }}
    />
  );
}
