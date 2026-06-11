import { ClinicSettingsCard } from '@/components/app/ClinicSettingsCard';
import { requireOnboardedPsychologist } from '@/lib/auth-page';

export const dynamic = 'force-dynamic';

/**
 * Sprint 39 — clinic settings (Phase 1). Shows the therapist's clinic,
 * its members + roles, and lets an owner/admin rename it. Member
 * management arrives in Phase 2.
 */
export default async function ClinicSettingsPage() {
  await requireOnboardedPsychologist();
  return <ClinicSettingsCard />;
}
