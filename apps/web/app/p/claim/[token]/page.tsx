'use client';

import { useParams } from 'next/navigation';
import type { User } from 'firebase/auth';
import ClientPhoneSignIn from '@/components/portal/ClientPhoneSignIn';

export default function ClaimCarePage() {
  const params = useParams<{ token: string }>();
  async function redeem(user: User) {
    const idToken = await user.getIdToken();
    const response = await fetch(`/api/v1/claim-tokens/${params.token}/redeem`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!response.ok) throw new Error();
    window.location.assign('/p/home');
  }

  return (
    <main className="mx-auto max-w-md px-4 py-12">
      <h1 className="font-serif text-3xl">Claim your care page</h1>
      <p className="mt-2 text-sm text-[var(--color-ink-2)]">
        Verify your phone to create private, durable access. This does not create a practitioner
        account.
      </p>
      <ClientPhoneSignIn
        onSignedIn={redeem}
        verificationButtonLabel="Open my care page"
        verificationErrorMessage="This care-access link is invalid, expired, or already used."
      />
    </main>
  );
}
