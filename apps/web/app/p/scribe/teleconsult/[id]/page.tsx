import type { Metadata } from 'next';
import { ScribePatientCall } from '@/components/video/ScribePatientCall';

export const metadata: Metadata = {
  title: 'Video consultation | Cureocity Scribe',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default async function ScribePatientCallPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // The private grant stays in the URL fragment and is never sent to the page server.
  return <ScribePatientCall teleconsultId={id} />;
}
