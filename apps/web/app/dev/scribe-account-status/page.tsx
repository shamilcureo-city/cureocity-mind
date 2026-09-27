import { notFound } from 'next/navigation';
import { PractitionerAccountStatus } from '@/components/app/PractitionerAccountStatus';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Scribe account access · fictional local preview',
  robots: { index: false, follow: false },
};

export default function AccountStatusPreview() {
  if (
    process.env['NODE_ENV'] !== 'development' ||
    process.env['SCRIBE_WORKSPACE_PREVIEW'] !== 'true'
  )
    notFound();
  return (
    <PractitionerAccountStatus
      status="PENDING_VERIFICATION"
      vertical="DOCTOR"
      email="doctor@example.test"
    />
  );
}
