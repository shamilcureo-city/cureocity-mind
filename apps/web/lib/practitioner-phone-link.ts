import { linkWithPhoneNumber, type ApplicationVerifier } from 'firebase/auth';
import { getFirebaseAuth } from './firebase-therapist';

/** Attach a verified provider to the SAME identity; never sign into a new one. */
export async function beginPractitionerPhoneLink(
  expectedUid: string,
  phone: string,
  verifier: ApplicationVerifier,
) {
  const user = getFirebaseAuth().currentUser;
  if (!user || user.uid !== expectedUid)
    throw new Error(
      'Sign in again with your original Google or email account before linking your phone.',
    );
  if (user.providerData.some((provider) => provider.providerId === 'phone'))
    throw new Error('Phone sign-in is already linked to this account.');
  const confirmation = await linkWithPhoneNumber(user, phone, verifier);
  return {
    async confirm(code: string) {
      if (getFirebaseAuth().currentUser?.uid !== expectedUid)
        throw new Error('Your sign-in changed. Reload before linking your phone.');
      const result = await confirmation.confirm(code);
      if (result.user.uid !== expectedUid || getFirebaseAuth().currentUser?.uid !== expectedUid)
        throw new Error('Phone linking could not be verified. Contact support.');
    },
  };
}

export function practitionerPhoneLinkError(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  if (
    code === 'auth/credential-already-in-use' ||
    code === 'auth/account-exists-with-different-credential'
  )
    return 'This phone has a separate sign-in already. Your current account has not been replaced. Contact support for verified account recovery; do not create another account.';
  if (code === 'auth/requires-recent-login')
    return 'Sign out and sign in again with your original Google or email method, then retry linking.';
  if (code === 'auth/invalid-verification-code')
    return 'That code did not match. Check the SMS and retry.';
  if (code)
    return 'Phone linking did not complete. Check your number, then retry. Your original sign-in is unchanged.';
  return error instanceof Error ? error.message : 'Phone linking did not complete.';
}
