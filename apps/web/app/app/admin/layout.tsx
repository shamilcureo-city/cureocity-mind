import type { ReactNode } from 'react';
import { Container } from '@/components/ui/Container';
import { AdminNav } from '@/components/app/admin/AdminNav';
import { requirePageAdmin } from '@/lib/auth-page';

export const dynamic = 'force-dynamic';

/**
 * PC2 — the super-admin console shell. ONE guard for the whole `/app/admin`
 * tree (every child page + its data loads only run for an ADMIN role;
 * non-admins are redirected to /app before any query fires). The console
 * nav renders above each page. Individual API routes re-check `requireAdmin`
 * independently — this layout guard is defence-in-depth for the pages, not
 * the only gate.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requirePageAdmin();
  return (
    <Container className="py-10">
      <AdminNav />
      {children}
    </Container>
  );
}
