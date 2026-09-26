import { notFound } from 'next/navigation';
import { ScribeTeleconsultPreview } from './ScribeTeleconsultPreview';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Scribe video consultation · local preview',
  robots: { index: false, follow: false },
};
export default function Page() {
  if (
    process.env['NODE_ENV'] !== 'development' ||
    process.env['SCRIBE_WORKSPACE_PREVIEW'] !== 'true'
  )
    notFound();
  return <ScribeTeleconsultPreview />;
}
