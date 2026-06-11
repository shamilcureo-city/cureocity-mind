'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/Button';

/**
 * Route-level error boundary. Shows a recoverable message instead of the
 * framework's default stack screen; the digest lets us correlate with
 * server logs without exposing internals to the user. Sprint 40 — also
 * reports to the observability ingest route.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    void fetch('/api/v1/observability/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: error.message,
        stack: error.stack,
        digest: error.digest,
        source: 'error-boundary',
        url: typeof window !== 'undefined' ? window.location.href : undefined,
      }),
    }).catch(() => {});
  }, [error]);

  return (
    <main className="grid min-h-screen place-items-center bg-[var(--color-bg)] p-6">
      <div className="max-w-md text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
          Something went wrong
        </p>
        <h1 className="mt-3 font-serif text-3xl">We couldn&rsquo;t load this page.</h1>
        <p className="mt-3 text-sm text-[var(--color-ink-2)]">
          Your data is safe — this is a display error, not a data loss. Try again, and if it keeps
          happening, sign out and back in.
        </p>
        {error.digest && (
          <p className="mt-2 font-mono text-xs text-[var(--color-ink-3)]">ref: {error.digest}</p>
        )}
        <div className="mt-6">
          <Button onClick={reset}>Try again</Button>
        </div>
      </div>
    </main>
  );
}
