'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import type { Client, SessionModality } from '@cureocity/contracts';
import { TherapistApi } from '@/lib/therapist-api';

/**
 * Client detail. Header + actions:
 *   - Start new session    -> creates a Session row + goes to capture
 *   - Pair device          -> issues a claim token via existing /pair page
 *   - Edit consents (later)
 */
export default function ClientDetailPage() {
  const params = useParams<{ clientId: string }>();
  const router = useRouter();
  const [client, setClient] = useState<Client | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const c = await TherapistApi.getClient(params.clientId);
        if (!cancelled) setClient(c);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [params.clientId]);

  async function startSession(modality: SessionModality): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const created = await TherapistApi.createSession({
        clientId: params.clientId,
        modality,
        scheduledAt: new Date().toISOString(),
      });
      router.push(`/t/clients/${params.clientId}/sessions/${created.id}/capture`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  if (error && !client) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-10">
        <BackLink />
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      </main>
    );
  }
  if (!client) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-10">
        <BackLink />
        <p className="mt-6 text-sm text-[var(--color-slate-500)]">Loading client…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <BackLink />

      <header className="mt-4 mb-8">
        <h1 className="text-3xl font-semibold text-[var(--color-navy-700)]">{client.fullName}</h1>
        <p className="mt-1 text-sm text-[var(--color-slate-500)]">
          {client.contactPhone}
          {client.preferredModality && ` · ${client.preferredModality}`} · {client.status}
        </p>
        {client.presentingConcerns && (
          <p className="mt-3 text-sm text-[var(--color-slate-900)]">{client.presentingConcerns}</p>
        )}
      </header>

      <section className="mb-6 rounded-2xl border border-[var(--color-navy-500)] bg-[var(--color-navy-50)] p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-slate-500)]">
          Start a session
        </h2>
        <p className="mt-1 text-xs text-[var(--color-slate-500)]">
          Creates a Session row in SCHEDULED state, then opens the capture screen.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {(['CBT', 'EMDR', 'OTHER'] as const).map((m) => (
            <button
              key={m}
              disabled={busy}
              onClick={() => startSession(m)}
              className="rounded-md bg-[var(--color-navy-700)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy ? 'Starting…' : `Start ${m}`}
            </button>
          ))}
        </div>
        {error && (
          <div
            role="alert"
            className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-[var(--color-slate-200)] bg-white p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-slate-500)]">
          Other actions
        </h2>
        <ul className="mt-3 space-y-2 text-sm">
          <li>
            <Link href={`/t/clients/${client.id}/pair`} className="underline">
              Pair client device (issue claim link / QR)
            </Link>
          </li>
          <li>
            <Link href={`/t/clients/${client.id}/consent`} className="underline">
              Capture session consent (WebAuthn)
            </Link>
          </li>
        </ul>
      </section>
    </main>
  );
}

function BackLink(): React.ReactNode {
  return (
    <Link href="/t/clients" className="text-xs underline">
      ← All clients
    </Link>
  );
}
