'use client';

import { useRouter } from 'next/navigation';
import { CareInstrumentForm } from './CareInstrumentForm';

/** CG1 — thin page wrapper: the starting-line PHQ-9 outside the report flow. */
export function BaselineCheckin() {
  const router = useRouter();
  return (
    <div className="mx-auto w-full max-w-md px-5 py-6 pb-28 md:max-w-2xl md:px-8 md:py-10">
      <h1 className="font-serif text-2xl font-semibold">Your starting line</h1>
      <p className="mt-1 text-sm text-[var(--color-ink-2)]">
        Where you&apos;re starting from — so your review can show real change, honestly.
      </p>
      <CareInstrumentForm
        framing="baseline"
        onDone={() => router.push('/care/home')}
        onSkip={() => router.push('/care/home')}
      />
    </div>
  );
}
