import { PreferencesSettingsForm } from '@/components/app/PreferencesSettingsForm';
import { LetterheadSettingsCard } from '@/components/app/LetterheadSettingsCard';
import { requireOnboardedPsychologist } from '@/lib/auth-page';
import { toPsychologist } from '@/lib/mappers';

export const dynamic = 'force-dynamic';

export default async function PreferencesSettingsPage() {
  const me = await requireOnboardedPsychologist();
  const dto = toPsychologist(me);
  return (
    <div className="space-y-6">
      <PreferencesSettingsForm initial={dto} />
      {/* Batch F — doctors print prescriptions; therapists don't, so the
          letterhead only shows on the vertical that uses it. */}
      {dto.vertical === 'DOCTOR' && (
        <LetterheadSettingsCard
          initial={{
            clinicName: dto.clinicName,
            clinicAddress: dto.clinicAddress,
            clinicPhone: dto.clinicPhone,
          }}
        />
      )}
    </div>
  );
}
