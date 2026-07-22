import { AdminPageHeader, AdminCard } from '@/components/console/AdminUI';
import { AuditBrowser } from '@/components/console/AuditBrowser';
import { requirePageAdmin } from '@/lib/auth-page';

export const dynamic = 'force-dynamic';

/**
 * PC2 — the audit browser page. The console layout guards ADMIN; the
 * browser component queries the admin-gated audit route (which re-checks
 * the role and logs each read).
 */
export default async function AdminAuditPage() {
  await requirePageAdmin();
  return (
    <>
      <AdminPageHeader
        eyebrow="Admin console"
        title="Audit trail"
        description="The append-only record of who did what. Filter by action, actor or target. Nothing here contains client clinical content — audit rows store ids and before/after state, never transcripts or notes."
      />
      <AdminCard>
        <AuditBrowser />
      </AdminCard>
    </>
  );
}
