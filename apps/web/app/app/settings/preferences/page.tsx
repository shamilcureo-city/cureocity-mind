import { notFound } from 'next/navigation';
import { PreferencesSettingsForm } from '@/components/app/PreferencesSettingsForm';
import { toPsychologist } from '@/lib/mappers';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export default async function PreferencesSettingsPage() {
  const me = await prisma.psychologist.findUnique({
    where: { firebaseUid: 'dev-firebase-uid-priya' },
  });
  if (!me) notFound();
  return <PreferencesSettingsForm initial={toPsychologist(me)} />;
}
