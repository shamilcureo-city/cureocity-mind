import { notFound } from 'next/navigation';
import { ScribeMicrophonePreview } from './ScribeMicrophonePreview';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Scribe microphone readiness · local diagnostics',
  robots: { index: false, follow: false },
};

export default function Page() {
  if (
    process.env['NODE_ENV'] !== 'development' ||
    process.env['SCRIBE_WORKSPACE_PREVIEW'] !== 'true'
  )
    notFound();
  return <ScribeMicrophonePreview />;
}
