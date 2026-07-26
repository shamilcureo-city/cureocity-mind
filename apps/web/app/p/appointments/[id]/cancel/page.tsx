import { CancelAppointmentCard } from '@/components/public/CancelAppointmentCard';

export const dynamic = 'force-dynamic';

/**
 * MK4 — the patient's "can't make it" page (linked from confirmation +
 * reminder emails). The cancel itself is a POST behind a button — a
 * link-prefetched GET must never cancel anything (the sign-out rule).
 */
export default async function CancelAppointmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sig?: string }>;
}) {
  const { id } = await params;
  const { sig } = await searchParams;
  return (
    <main className="grid min-h-screen place-items-center bg-[var(--color-bg)] p-6">
      <CancelAppointmentCard appointmentId={id} sig={sig ?? ''} />
    </main>
  );
}
