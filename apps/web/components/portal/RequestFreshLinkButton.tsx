'use client';

import { useState } from 'react';

export function RequestFreshLinkButton({ token }: { token: string }) {
  const [state, setState] = useState<'IDLE' | 'BUSY' | 'DONE'>('IDLE');

  async function request() {
    setState('BUSY');
    try {
      await fetch(`/api/v1/p/${token}/request-new-link`, { method: 'POST' });
    } finally {
      // Keep the response generic to avoid disclosing whether the token exists.
      setState('DONE');
    }
  }

  if (state === 'DONE') {
    return (
      <p className="mt-4">
        Request received. Your care team will see it if this link can be refreshed.
      </p>
    );
  }
  return (
    <button
      className="mt-4 rounded-full bg-[var(--color-accent)] px-4 py-2 text-white disabled:opacity-60"
      type="button"
      disabled={state === 'BUSY'}
      onClick={() => void request()}
    >
      {state === 'BUSY' ? 'Requesting…' : 'Request a new link'}
    </button>
  );
}
