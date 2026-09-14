import { notFound } from 'next/navigation';
import '@/app/app/mind-workspace.css';
import { MindWorkHistoryPreview } from './MindWorkHistoryPreview';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Mind work history · fictional local preview',
  robots: { index: false, follow: false },
};

export default function MindWorkHistoryPreviewPage() {
  if (process.env['NODE_ENV'] !== 'development' || process.env['MIND_WORKSPACE_PREVIEW'] !== 'true')
    notFound();
  return <MindWorkHistoryPreview />;
}
