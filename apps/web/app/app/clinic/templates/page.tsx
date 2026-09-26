import Link from 'next/link';
import { requireOnboardedDoctor } from '@/lib/auth-page';
import { ScribeDoctorTemplatesWorkspace } from '@/components/app/ScribeDoctorTemplatesWorkspace';

export const dynamic = 'force-dynamic';

export default async function DoctorTemplatesPage() {
  await requireOnboardedDoctor();
  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <Link
        href="/app/clinic"
        className="mb-4 inline-flex min-h-11 items-center text-sm underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4"
      >
        Back to clinic
      </Link>
      <h1 className="font-serif text-3xl">My templates</h1>
      <p className="mb-6 mt-2 max-w-3xl text-sm text-[var(--color-ink-2)]">
        Your note layouts and blank document completion fields. Keep patient names, contact details,
        clinical findings and consultation text out of this reusable library.
      </p>
      <ScribeDoctorTemplatesWorkspace />
    </main>
  );
}
