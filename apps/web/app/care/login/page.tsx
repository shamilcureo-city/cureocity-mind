import type { Metadata } from 'next';
import { isAuthBypassed } from '@/lib/auth-server';
import { CareLogin } from '@/components/care/CareLogin';

export const metadata: Metadata = { title: 'Sign in — Cureocity Care' };
// Runtime-evaluated: whether the demo door works depends on the deploy's
// live auth-bypass state (AUTH_BYPASS / server Firebase presence), which
// isn't known at build time.
export const dynamic = 'force-dynamic';

export default function CareLoginPage() {
  // Pass the SERVER's bypass truth to the client. The demo button only
  // works when the server resolves the seeded demo user (bypass on); the
  // client Firebase keys are a separate signal, so decide with this.
  return <CareLogin demoMode={isAuthBypassed()} />;
}
