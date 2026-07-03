import { InsightsBoard } from '@/components/app/InsightsBoard';
import { requireOnboardedDoctor } from '@/lib/auth-page';
import { istDayRange } from '@/lib/clinic-queue';
import { loadDoctorInsights } from '@/lib/insights';

export const dynamic = 'force-dynamic';

/**
 * Sprint DS9 — the doctor's end-of-clinic insights (screen 11). Doctor-
 * guarded; the rollup is composed by the shared lib/insights reader so this
 * page and GET /api/v1/insights never drift. See DS9 in the sprint plan.
 */
export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const doctor = await requireOnboardedDoctor();
  const sp = await searchParams;
  const days = Math.min(90, Math.max(1, Math.floor(Number(sp.days) || 1)));

  const { end } = istDayRange(new Date());
  const from = new Date(end.getTime() - days * 86_400_000);
  const insights = await loadDoctorInsights(doctor.id, from, end);

  return <InsightsBoard insights={insights} days={days} />;
}
