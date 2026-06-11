import Link from 'next/link';
import { Container } from '@/components/ui/Container';
import { InviteCodesClient } from '@/components/app/InviteCodesClient';
import { requirePageAdmin } from '@/lib/auth-page';

export const dynamic = 'force-dynamic';

/**
 * Sprint 37 — admin surface to mint / revoke pilot invite codes.
 * Admin-only (requirePageAdmin). Codes gate the auto-provision signup
 * when PILOT_INVITE_REQUIRED=true.
 */
export default async function InviteCodesPage() {
  await requirePageAdmin();
  return (
    <Container className="py-10">
      <p className="mb-4 text-xs text-[var(--color-ink-3)]">
        <Link href="/app" className="hover:text-[var(--color-ink)]">
          ← Home
        </Link>
      </p>
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
          Pilot admin
        </p>
        <h1 className="mt-2 font-serif text-3xl">Invite codes</h1>
        <p className="mt-2 max-w-xl text-sm text-[var(--color-ink-2)]">
          Mint a code for an invited therapist. When{' '}
          <code className="rounded bg-[var(--color-surface-soft)] px-1.5 py-0.5 text-xs">
            PILOT_INVITE_REQUIRED=true
          </code>{' '}
          is set, a new therapist must enter a valid code at sign-up. Multi-use codes can seat a
          whole cohort.
        </p>
      </header>
      <InviteCodesClient />
    </Container>
  );
}
