import { notFound } from 'next/navigation';
import { ScribeSourceReviewPreview } from './ScribeSourceReviewPreview';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Scribe source comparison · local preview',
  robots: { index: false, follow: false },
};

export default function Page() {
  if (
    process.env['NODE_ENV'] !== 'development' ||
    process.env['SCRIBE_WORKSPACE_PREVIEW'] !== 'true'
  )
    notFound();
  return <ScribeSourceReviewPreview />;
}
