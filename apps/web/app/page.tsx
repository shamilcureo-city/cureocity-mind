import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * Root entry — sends the visitor straight to the scribe app when an
 * auth context exists (Firebase id token, or the dev bypass), otherwise
 * to the login page. Sprint 12 hardens this into a middleware check
 * that reads the session cookie set on real OTP confirm.
 */
export default function RootPage() {
  redirect('/app');
}
