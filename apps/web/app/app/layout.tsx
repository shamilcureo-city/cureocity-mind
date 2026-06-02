import type { ReactNode } from 'react';
import { Sidebar } from '@/components/app/Sidebar';

export const dynamic = 'force-dynamic';

/**
 * Authenticated scribe shell. Klarify-parity left nav + main content
 * pane. Auth gate lives at the page/route level for now; Sprint 12
 * hardens this into a middleware redirect when real Firebase auth
 * lands.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-[var(--color-bg)]">
      <Sidebar />
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
