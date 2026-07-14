import type { Metadata } from 'next';
import { CareIntentLanding } from '@/components/care/CareIntentLanding';

export const metadata: Metadata = {
  title: 'Therapy costs ₹800–3,500 a session in India. Talking shouldn’t. — Cureocity Care',
  description:
    'Two real voice therapy sessions a week — free, always, in your language. An AI therapist that shows its work, and says plainly what it is.',
};

/** CG5 — the /care/cant-afford-therapy intent landing. */
export default function CareAffordPage() {
  const signupsOpen = process.env['CARE_SIGNUPS_OPEN'] === 'true';
  return (
    <CareIntentLanding
      signupsOpen={signupsOpen}
      content={{
        hero: 'Therapy costs ₹800–3,500 a session in India. Talking shouldn’t be a luxury.',
        sub: 'Two real voice sessions a week — free, always. Not a trial, not a teaser: the full loop, with a written plan and honestly measured progress. Your therapist is an AI, and we say it plainly — that is why it can be free.',
        points: [
          {
            title: 'Free means the whole thing',
            body: 'The first real session, your written assessment and plan, two sessions every week, every report — free on the free tier, forever. Safety support is free on every tier, always.',
          },
          {
            title: 'It shows its work',
            body: 'Every session ends in a written report that quotes your own words. Every few weeks, the same questionnaires clinicians use say whether it is actually helping.',
          },
          {
            title: 'And it knows its limits',
            body: 'When the numbers say a human therapist is the right next step, it says so — plainly. An AI has limits; pretending otherwise would cost you more than money.',
          },
        ],
        cta: 'Start free — 2 sessions a week',
      }}
    />
  );
}
