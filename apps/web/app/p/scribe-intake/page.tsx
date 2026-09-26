import type { Metadata } from 'next';
import { ScribeIntakeForm } from '@/components/app/ScribeIntakeForm';

export const metadata: Metadata = {
  title: 'Previsit intake',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export default function ScribeIntakePage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <ScribeIntakeForm />
    </main>
  );
}
