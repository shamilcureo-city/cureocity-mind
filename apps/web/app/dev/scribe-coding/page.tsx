import { notFound } from 'next/navigation';
import { ScribeCodingPreview } from './ScribeCodingPreview';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Scribe coding worksheet · local preview',
  robots: { index: false, follow: false },
};

export default function Page() {
  if (
    process.env['NODE_ENV'] !== 'development' ||
    process.env['SCRIBE_WORKSPACE_PREVIEW'] !== 'true'
  )
    notFound();
  return <ScribeCodingPreview />;
}
