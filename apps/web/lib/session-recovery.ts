/** Explicit recovery only: never remint a cookie, choose an account, or replay a write. */
export async function recoverPractitionerSession({
  fetch: send,
  signOut,
  navigate,
}: {
  fetch: typeof fetch;
  signOut: () => Promise<void>;
  navigate: (url: string) => void;
}): Promise<void> {
  await signOut();
  const response = await send('/api/v1/auth/session', {
    method: 'DELETE',
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('Session recovery failed');
  // Full navigation discards the old page identity and its fetch interceptor.
  navigate('/login?reason=session-changed');
}
