import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import '@/app/app/mind-workspace.css';
import { MindWorkspacePreview } from './MindWorkspacePreview';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Mind workspace · local design preview',
  robots: { index: false, follow: false },
};

export default function MindWorkspacePreviewPage() {
  if (
    process.env['NODE_ENV'] !== 'development' ||
    process.env['MIND_WORKSPACE_PREVIEW'] !== 'true'
  ) {
    notFound();
  }
  return <MindWorkspacePreview />;
}
