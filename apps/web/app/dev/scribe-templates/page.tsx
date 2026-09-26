import { notFound } from 'next/navigation';
import { ScribeTemplatesPreview } from './ScribeTemplatesPreview';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Scribe doctor templates · local preview',
  robots: { index: false, follow: false },
};

export default function Page() {
  if (
    process.env['NODE_ENV'] !== 'development' ||
    process.env['SCRIBE_WORKSPACE_PREVIEW'] !== 'true'
  )
    notFound();
  return <ScribeTemplatesPreview />;
}
