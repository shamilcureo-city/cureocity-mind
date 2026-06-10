import Link from 'next/link';
import { Container } from '@/components/ui/Container';
import { ErasureQueueClient } from '@/components/app/ErasureQueueClient';
import { requireOnboardedPsychologist } from '@/lib/auth-page';

export const dynamic = 'force-dynamic';

/**
 * Admin queue for DPDP § 15 erasure requests. Pilot scope: each
 * therapist reviews their own clients' requests (the data fiduciary
 * is single-tenant; the API scopes rows by psychologistId). Sprint 10
 * widens to a clinic-admin role.
 */
export default async function ErasureQueuePage() {
  await requireOnboardedPsychologist();
  return (
    <Container className="py-10">
      <p className="mb-4 text-xs text-[var(--color-ink-3)]">
        <Link href="/app/clients" className="hover:text-[var(--color-ink)]">
          ← Clients
        </Link>
      </p>
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
          Compliance
        </p>
        <h1 className="mt-2 font-serif text-3xl">Erasure queue</h1>
        <p className="mt-2 max-w-xl text-sm text-[var(--color-ink-2)]">
          DPDP § 15 erasure requests awaiting review. Review each, then approve, reject, or
          fulfil directly. The 30-day statutory clock starts at request createdAt.
        </p>
      </header>
      <ErasureQueueClient />
    </Container>
  );
}
