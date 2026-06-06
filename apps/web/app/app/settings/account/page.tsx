import { notFound } from 'next/navigation';
import { AccountSettingsForm } from '@/components/app/AccountSettingsForm';
import { toPsychologist } from '@/lib/mappers';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * Dev shortcut — reads the seeded Priya fixture. Replace with
 * requirePsychologistId-driven RSC once Firebase real-auth lands.
 */
async function loadMe() {
  return prisma.psychologist.findUnique({
    where: { firebaseUid: 'dev-firebase-uid-priya' },
  });
}

export default async function AccountSettingsPage() {
  const me = await loadMe();
  if (!me) notFound();
  return <AccountSettingsForm initial={toPsychologist(me)} />;
}
