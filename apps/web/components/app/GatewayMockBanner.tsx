'use client';

import { useEffect, useState } from 'react';

/**
 * An unmissable "this is demo data" banner for the LIVE surfaces.
 *
 * The batch pipeline already has MockBackendBanner (server-rendered off the
 * web app's own LLM_BACKEND), but the live consult runs on the GATEWAY,
 * whose backend can differ — and the gateway's canned mock consult carries
 * no [mock] tags on the doctor path, so a silent room still "produces" a
 * full Hinglish diabetes consult. That reads as a malfunction, not demo
 * data. This asks the DS11.4 preflight (/api/v1/live/health proxies the
 * gateway's /healthz, which reports its backend) and shows a loud banner
 * whenever the CONNECTED gateway is on mock.
 *
 * Renders nothing while checking, on a real backend, or when the gateway
 * is unreachable (the preflight's "Dictate instead" degrade covers that).
 */
export function GatewayMockBanner() {
  const [mock, setMock] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/v1/live/health');
        const body = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          backend?: string | null;
        };
        if (!cancelled && body.ok === true && body.backend === 'mock') setMock(true);
      } catch {
        /* unreachable gateway is the preflight's problem, not this banner's */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!mock) return null;
  return (
    <div
      role="alert"
      className="rounded-2xl border-2 border-[var(--color-warn)] bg-[var(--color-warn-soft)] px-5 py-3"
    >
      <p className="text-sm font-semibold text-[var(--color-warn)]">
        ⚠ Demo data — the live AI backend is in mock mode
      </p>
      <p className="mt-0.5 text-sm text-[var(--color-ink-2)]">
        The transcript, note, and suggestions are canned samples — they do <b>not</b> come from your
        microphone. To transcribe real consults, set{' '}
        <code className="rounded bg-white px-1 py-0.5 text-xs">LLM_BACKEND=vertex</code> (plus{' '}
        <code className="rounded bg-white px-1 py-0.5 text-xs">VERTEX_PROJECT_ID</code> and the
        service-account credentials) on the live gateway and restart it.
      </p>
    </div>
  );
}
