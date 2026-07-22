import {
  AdminPageHeader,
  StatGrid,
  StatTile,
  AdminCard,
  DefRow,
  Pill,
} from '@/components/console/AdminUI';
import { CareWaitlistManager } from '@/components/console/CareWaitlistManager';
import { prisma } from '@/lib/prisma';
import { requirePageAdmin } from '@/lib/auth-page';

export const dynamic = 'force-dynamic';

/**
 * PC2 — Care product admin. Signup gate, user population by status,
 * safety-hold queue size, and the waitlist manager. Consumer contact
 * details on the waitlist are shown to the admin who manages invitations.
 */
export default async function AdminCarePage() {
  await requirePageAdmin();
  const [active, safetyHold, deleted, waitingCount, invitedCount, entries, sessions30d] =
    await Promise.all([
      prisma.careUser.count({ where: { status: 'ACTIVE' } }),
      prisma.careUser.count({ where: { status: 'SAFETY_HOLD' } }),
      prisma.careUser.count({ where: { status: 'DELETED' } }),
      prisma.careWaitlistEntry.count({ where: { invitedAt: null } }),
      prisma.careWaitlistEntry.count({ where: { invitedAt: { not: null } } }),
      prisma.careWaitlistEntry.findMany({
        orderBy: [{ invitedAt: 'asc' }, { createdAt: 'asc' }],
        take: 200,
        select: { id: true, contact: true, createdAt: true, invitedAt: true },
      }),
      prisma.careSession.count({
        where: { createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
      }),
    ]);

  const signupsOpen = process.env['CARE_SIGNUPS_OPEN'] === 'true';
  const weeklyFree = process.env['CARE_WEEKLY_CAP_FREE'] ?? '2';
  const weeklyPlus = process.env['CARE_WEEKLY_CAP_PLUS'] ?? '4';
  const liveBackend = process.env['CARE_LIVE_BACKEND'] ?? 'mock';

  return (
    <>
      <AdminPageHeader
        eyebrow="Admin console"
        title="Care"
        description="The consumer AI-therapist product. Sign-ups stay gated behind a waitlist until the launch blockers clear — manage that queue here."
      />

      <StatGrid>
        <StatTile
          label="Active users"
          value={String(active)}
          sub={`${sessions30d} sessions · 30d`}
        />
        <StatTile
          label="Safety hold"
          value={String(safetyHold)}
          tone={safetyHold > 0 ? 'warn' : 'default'}
        />
        <StatTile label="Waitlist · waiting" value={String(waitingCount)} tone="accent" />
        <StatTile label="Waitlist · invited" value={String(invitedCount)} />
      </StatGrid>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <AdminCard
          title="Product gate & caps"
          hint="From the deployment environment (read-only here)"
        >
          <div className="space-y-0">
            <DefRow label="Consumer sign-ups">
              {signupsOpen ? <Pill tone="good">open</Pill> : <Pill tone="warn">waitlist only</Pill>}
            </DefRow>
            <DefRow label="Live backend">
              {liveBackend === 'mock' ? (
                <Pill tone="warn">mock</Pill>
              ) : (
                <Pill tone="good">{liveBackend}</Pill>
              )}
            </DefRow>
            <DefRow label="Weekly cap · free">{weeklyFree}</DefRow>
            <DefRow label="Weekly cap · plus">{weeklyPlus}</DefRow>
            <DefRow label="Deleted (tombstoned)">{deleted}</DefRow>
          </div>
        </AdminCard>

        <AdminCard
          title="Waitlist"
          hint={`${entries.length} shown${entries.length === 200 ? ' (first 200)' : ''}`}
        >
          <CareWaitlistManager
            entries={entries.map((e) => ({
              ...e,
              createdAt: e.createdAt.toISOString(),
              invitedAt: e.invitedAt?.toISOString() ?? null,
            }))}
          />
        </AdminCard>
      </div>
    </>
  );
}
