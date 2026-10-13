import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import '@/app/app/mind-workspace.css';
import { MindVisualDesignPreview } from './MindVisualDesignPreview';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Mind visual workspace · local fixture',
  robots: { index: false, follow: false },
};

export default function MindVisualDesignPage() {
  if (
    process.env['NODE_ENV'] !== 'development' ||
    process.env['MIND_WORKSPACE_PREVIEW'] !== 'true'
  ) {
    notFound();
  }
  return <MindVisualDesignPreview />;
}
