'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import QRCode from 'qrcode';
import type { ClientClaimToken } from '@cureocity/contracts';

const PATIENT_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '/api/v1';

/**
 * PairPage — therapist-side QR generator. Issues a single-use claim
 * token via patient-model-service, then renders a QR encoding the
 * client-web /claim/[token] URL. The therapist shows the QR (laptop
 * screen or printed handout) to the patient, who scans it on their
 * phone, completes Firebase phone OTP, and is paired.
 *
 * Token URL is also shown as text so the therapist can copy/paste into
 * WhatsApp for remote clients (the WATI integration in PR 4 will do
 * this automatically).
 */
export default function PairPage() {
  const params = useParams<{ clientId: string }>();
  const [token, setToken] = useState<ClientClaimToken | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function issue(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `${PATIENT_BASE}/clients/${encodeURIComponent(params.clientId)}/claim-token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        },
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Issue failed: ${res.status} ${text}`);
      }
      const issued = (await res.json()) as ClientClaimToken;
      setToken(issued);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const claimUrl = token
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/c/claim/${token.token}`
    : null;

  useEffect(() => {
    if (!claimUrl) return;
    QRCode.toDataURL(claimUrl, { width: 320, margin: 1, errorCorrectionLevel: 'M' })
      .then((dataUrl) => setQrDataUrl(dataUrl))
      .catch((e: Error) => setError(`QR render failed: ${e.message}`));
  }, [claimUrl]);

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <header className="mb-6">
        <p className="text-xs uppercase tracking-wide text-[var(--color-slate-500)]">
          Client {params.clientId}
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-[var(--color-navy-700)]">
          Pair the patient app
        </h1>
        <p className="mt-2 text-sm text-[var(--color-slate-500)]">
          Generate a single-use pairing link. The patient scans the QR on their phone, completes
          mobile OTP, and their Cureocity Mind PWA links to this client record.
        </p>
      </header>

      {!token && (
        <button
          type="button"
          onClick={issue}
          disabled={busy}
          className="w-full rounded-md bg-[var(--color-navy-700)] px-4 py-3 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? 'Generating…' : 'Generate pairing QR'}
        </button>
      )}

      {token && (
        <section className="rounded-2xl border border-[var(--color-slate-200)] bg-white p-6">
          <p className="mb-4 text-sm text-[var(--color-slate-500)]">
            Expires {new Date(token.expiresAt).toLocaleString()}
          </p>
          {qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt="Pairing QR code"
              width={320}
              height={320}
              className="mx-auto rounded-md"
            />
          ) : (
            <p className="text-sm text-[var(--color-slate-500)]">Rendering QR…</p>
          )}
          {claimUrl && (
            <div className="mt-6">
              <p className="text-xs uppercase tracking-wide text-[var(--color-slate-500)]">
                Or share this link
              </p>
              <code className="mt-1 block break-all rounded-md border border-[var(--color-slate-200)] bg-[var(--color-slate-50)] p-3 text-xs">
                {claimUrl}
              </code>
            </div>
          )}
        </section>
      )}

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </div>
      )}
    </main>
  );
}
