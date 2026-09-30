import { notFound } from 'next/navigation';
import ForDoctorsLanding from '../../for-doctors/page';
export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Scribe UAE landing · local preview',
  robots: { index: false, follow: false },
};
export default function Page() {
  if (
    process.env['NODE_ENV'] !== 'development' ||
    process.env['SCRIBE_WORKSPACE_PREVIEW'] !== 'true'
  )
    notFound();
  return <ForDoctorsLanding />;
}
