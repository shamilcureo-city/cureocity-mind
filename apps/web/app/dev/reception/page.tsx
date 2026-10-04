import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { ReceptionPreview } from '@/components/reception/ReceptionPreview';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Local reception preview',
  robots: { index: false, follow: false },
};

export default function ReceptionPreviewPage() {
  if (
    process.env['NODE_ENV'] !== 'development' ||
    process.env['RECEPTION_WORKSPACE_PREVIEW'] !== 'true'
  )
    notFound();
  return <ReceptionPreview />;
}
