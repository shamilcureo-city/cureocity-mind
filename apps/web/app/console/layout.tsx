import type { ReactNode } from 'react';
import Link from 'next/link';
import { Container } from '@/components/ui/Container';
import { AdminNav } from '@/components/console/AdminNav';
import { AuthedFetchProvider } from '@/components/app/AuthedFetchProvider';
import { requirePageAdmin } from '@/lib/auth-page';

export const dynamic = 'force-dynamic';

/**
 * The Cureocity Operator Console — a STANDALONE platform-admin surface,
 * deliberately OUTSIDE the practitioner `/app` dashboard. It has its own
 * shell (no therapist Sidebar / MobileNav / plan widget), its own dark
 * "control-room" top bar, and its own route tree at `/console/*`. In
 * production it also fronts the `admin.cureocity.in` host (middleware
 * rewrites that host's `/` here); on localhost/previews it's reached at
 * `/console` directly.
 *
 * Authorization is defence-in-depth, NOT layout-only. This layout runs
 * `requirePageAdmin()` on the first (full-page) load, but a Next.js App
 * Router layout is a cached common segment that does NOT re-render on
 * client-side `<Link>` navigation between sibling pages — so the layout
 * guard alone would let a mid-session-revoked admin keep loading console
 * data by clicking the nav. Therefore EVERY `/console/*` page ALSO calls
 * `requirePageAdmin()` itself (it re-runs per navigation, cheap since every
 * page is `force-dynamic`). Every `/api/v1/admin/*` route re-checks
 * `requireAdmin` too. Non-admins are bounced to `/app`, unauthenticated
 * visitors to `/login`.
 *
 * `AuthedFetchProvider` is mounted here (not inherited from `/app`, which
 * this tree is intentionally not under) so the console's client components
 * (AccountActions, AuditBrowser, CareWaitlistManager) carry the operator's
 * Bearer token on their `/api/v1/admin/*` fetches.
 */
export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const operator = await requirePageAdmin();

  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-bg)]">
      <AuthedFetchProvider />

      {/* Control-room top bar — deliberately dark so it never reads as the
          product. Brand · operator identity · escape hatch · sign out. */}
      <header className="bg-[var(--color-ink)] text-white">
        <Container className="flex h-14 items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="grid h-7 w-7 place-items-center rounded-lg bg-white/10 ring-1 ring-white/15"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z"
                  stroke="#fff"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M9.5 12l1.8 1.8L15 10"
                  stroke="#fff"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <div className="leading-tight">
              <div className="font-serif text-[15px] tracking-tight">
                Cureocity <span className="text-white/60">·</span> Operator Console
              </div>
              <div className="text-[11px] text-white/45">Platform administration — not the app</div>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs">
            <span className="hidden text-white/55 sm:inline">{operator.email}</span>
            <Link
              href="/app"
              className="rounded-full px-3 py-1.5 text-white/75 ring-1 ring-white/15 transition-colors hover:bg-white/10 hover:text-white"
            >
              Open app ↗
            </Link>
            {/* POST-only sign out (a GET Link would be prefetched and clear
                the cookie out from under the operator — see auth/signout). */}
            <form method="POST" action="/api/v1/auth/signout">
              <button
                type="submit"
                className="rounded-full px-3 py-1.5 text-white/75 ring-1 ring-white/15 transition-colors hover:bg-white/10 hover:text-white"
              >
                Sign out
              </button>
            </form>
          </div>
        </Container>
      </header>

      <main className="flex-1 py-9">
        <Container>
          <AdminNav />
          {children}
        </Container>
      </main>
    </div>
  );
}
