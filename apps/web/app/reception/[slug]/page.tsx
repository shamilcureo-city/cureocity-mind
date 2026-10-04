import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { PublicReception } from '@/components/reception/PublicReception';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Practice reception | Cureocity',
  description: 'Approved practice information and appointment requests.',
  robots: { index: false, follow: false },
};

export default async function PublicReceptionPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  if (process.env['RECEPTION_PILOT_ENABLED'] !== 'true') notFound();
  const { slug } = await params;
  return <PublicReception slug={slug} />;
}
