import { CompForm } from '@/components/app/CompForm';
import { requirePageAdmin } from '@/lib/auth-page';

export const dynamic = 'force-dynamic';

/**
 * Sprint 56 ops — admin surface to comp a therapist onto a paid tier
 * without going through Razorpay. Admin-only (requirePageAdmin). Useful
 * for founder comps, friendly pilots, refund-equivalents, and clinic
 * billing arrangements made outside the product.
 */
export default async function AdminCompPage() {
  await requirePageAdmin();
  return (
    <>
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
          Pilot admin
        </p>
        <h1 className="mt-2 font-serif text-3xl">Comp an account</h1>
        <p className="mt-2 max-w-xl text-sm text-[var(--color-ink-2)]">
          Bypass Razorpay and grant a therapist a paid tier for a fixed window. Every comp writes a{' '}
          <code className="rounded bg-[var(--color-surface-soft)] px-1 text-xs">PLAN_UPGRADED</code>{' '}
          audit row tagged{' '}
          <code className="rounded bg-[var(--color-surface-soft)] px-1 text-xs">comp:true</code> so
          the funnel dashboard&rsquo;s MRR card can distinguish comped accounts from real revenue.
        </p>
      </header>
      <CompForm />
    </>
  );
}
