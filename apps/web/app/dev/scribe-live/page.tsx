import { notFound } from 'next/navigation';
import { ScribeLivePreview } from './ScribeLivePreview';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Scribe consultation · local preview',
  robots: { index: false, follow: false },
};

export default function ScribeLivePreviewPage() {
  if (
    process.env['NODE_ENV'] !== 'development' ||
    process.env['SCRIBE_WORKSPACE_PREVIEW'] !== 'true'
  )
    notFound();
  return <ScribeLivePreview />;
}
