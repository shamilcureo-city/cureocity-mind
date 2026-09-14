import { notFound } from 'next/navigation';
import '@/app/app/mind-workspace.css';
import { MindReviewPreview } from './MindReviewPreview';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Mind review · fictional local preview',
  robots: { index: false, follow: false },
};
export default function MindReviewPreviewPage() {
  if (process.env['NODE_ENV'] !== 'development' || process.env['MIND_WORKSPACE_PREVIEW'] !== 'true')
    notFound();
  return <MindReviewPreview />;
}
