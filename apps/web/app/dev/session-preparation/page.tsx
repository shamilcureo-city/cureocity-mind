import { notFound } from 'next/navigation';
import '@/app/app/mind-workspace.css';
import { SessionPreparationPreview } from './SessionPreparationPreview';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Mind preparation · fictional local preview',
  robots: { index: false, follow: false },
};

/** Explicit fictional transport only; no account, clinical record, database or model access. */
export default function SessionPreparationPreviewPage() {
  if (process.env['NODE_ENV'] !== 'development' || process.env['MIND_WORKSPACE_PREVIEW'] !== 'true')
    notFound();
  return <SessionPreparationPreview />;
}
