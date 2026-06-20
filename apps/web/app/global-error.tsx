'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

/**
 * Sprint 40 — root error boundary.
 * Sprint 57 — also forwards to Sentry.
 *
 * Catches errors thrown in the root layout itself (which app/error.tsx
 * cannot, since it renders inside the layout). It must provide its own
 * <html>/<body>. On mount it reports to Sentry AND the observability
 * ingest route, then shows a minimal recoverable screen.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error, {
      tags: { source: 'global-error', ...(error.digest && { digest: error.digest }) },
    });
    void fetch('/api/v1/observability/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: error.message,
        stack: error.stack,
        digest: error.digest,
        source: 'global-error',
        url: typeof window !== 'undefined' ? window.location.href : undefined,
      }),
    }).catch(() => {});
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          background: '#faf7f2',
          color: '#0f1b2a',
          fontFamily: 'Inter, system-ui, sans-serif',
          padding: 24,
        }}
      >
        <div style={{ maxWidth: 420, textAlign: 'center' }}>
          <p
            style={{
              fontSize: 12,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.18em',
              color: '#2d5f4d',
            }}
          >
            Something went wrong
          </p>
          <h1 style={{ marginTop: 12, fontSize: 28, fontWeight: 600 }}>
            We couldn&rsquo;t load the app.
          </h1>
          <p style={{ marginTop: 12, fontSize: 14, color: '#4a5566', lineHeight: 1.5 }}>
            Your data is safe — this is a display error. Try again, and if it keeps happening, sign
            out and back in.
          </p>
          {error.digest && (
            <p style={{ marginTop: 8, fontSize: 12, color: '#7b8694', fontFamily: 'monospace' }}>
              ref: {error.digest}
            </p>
          )}
          <button
            onClick={reset}
            style={{
              marginTop: 24,
              height: 44,
              padding: '0 24px',
              borderRadius: 9999,
              border: 'none',
              background: '#2d5f4d',
              color: 'white',
              fontSize: 15,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
