'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import type { Client, CreateClientInput, SessionModality } from '@cureocity/contracts';
import { TherapistApi } from '@/lib/therapist-api';

/**
 * Therapist clients home. Shows the list, with an inline "add client"
 * form. Calls /api/v1/clients (GET + POST). With AUTH_BYPASS=true on
 * the server, no Firebase ID token is needed and the seeded dev
 * psychologist owns whatever is returned/created.
 */
export default function ClientsIndexPage() {
  const [clients, setClients] = useState<Client[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load(): Promise<void> {
    try {
      const res = await TherapistApi.listClients();
      setClients(res.items);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-[var(--color-slate-500)]">
            Cureocity Mind · Therapist
          </p>
          <h1 className="mt-1 text-3xl font-semibold text-[var(--color-navy-700)]">Clients</h1>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-md bg-[var(--color-navy-700)] px-3 py-2 text-sm font-medium text-white"
        >
          {showForm ? 'Cancel' : '+ Add client'}
        </button>
      </header>

      {showForm && <AddClientForm onCreated={() => { setShowForm(false); void load(); }} />}

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {clients === null && !error && (
        <p className="text-sm text-[var(--color-slate-500)]">Loading clients…</p>
      )}

      {clients && clients.length === 0 && (
        <p className="rounded-2xl border border-[var(--color-slate-200)] bg-white p-6 text-sm text-[var(--color-slate-500)]">
          No clients yet. Use &ldquo;Add client&rdquo; above to create your first one.
        </p>
      )}

      {clients && clients.length > 0 && (
        <ul className="space-y-2">
          {clients.map((c) => (
            <li key={c.id} className="rounded-2xl border border-[var(--color-slate-200)] bg-white">
              <Link href={`/t/clients/${c.id}`} className="block px-5 py-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-[var(--color-navy-700)]">{c.fullName}</p>
                    <p className="text-xs text-[var(--color-slate-500)]">
                      {c.contactPhone}
                      {c.preferredModality && ` · ${c.preferredModality}`}
                      {' · '}
                      <span
                        className={
                          c.status === 'ACTIVE'
                            ? 'text-emerald-700'
                            : 'text-[var(--color-slate-500)]'
                        }
                      >
                        {c.status}
                      </span>
                    </p>
                  </div>
                  <span className="text-[var(--color-slate-500)]">→</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-10 text-center text-xs text-[var(--color-slate-500)]">
        <Link href="/" className="underline">
          ← Back to home
        </Link>
      </p>
    </main>
  );
}

function AddClientForm({ onCreated }: { onCreated: () => void }): React.ReactNode {
  const [fullName, setFullName] = useState('');
  const [contactPhone, setContactPhone] = useState('+91');
  const [contactEmail, setContactEmail] = useState('');
  const [presentingConcerns, setPresentingConcerns] = useState('');
  const [preferredModality, setPreferredModality] = useState<SessionModality>('CBT');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    if (!/^\+91\d{10}$/.test(contactPhone)) {
      setError('Phone must be +91 followed by 10 digits');
      return;
    }
    setBusy(true);
    try {
      const input: CreateClientInput = {
        fullName: fullName.trim(),
        contactPhone,
        preferredModality,
        consents: [
          {
            scope: 'AUDIO_RECORDING',
            scriptVersion: 'v1.0',
            capturedVia: 'IN_PERSON',
          },
          {
            scope: 'AI_NOTE_GENERATION',
            scriptVersion: 'v1.0',
            capturedVia: 'IN_PERSON',
          },
        ],
      };
      if (contactEmail.trim()) input.contactEmail = contactEmail.trim();
      if (presentingConcerns.trim()) input.presentingConcerns = presentingConcerns.trim();
      await TherapistApi.createClient(input);
      onCreated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mb-6 space-y-3 rounded-2xl border border-[var(--color-navy-500)] bg-[var(--color-navy-50)] p-5"
    >
      <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-slate-500)]">
        New client
      </h2>
      <label className="block text-sm">
        Full name
        <input
          type="text"
          required
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className="mt-1 w-full rounded-md border border-[var(--color-slate-200)] bg-white px-3 py-2 text-sm"
        />
      </label>
      <label className="block text-sm">
        Mobile number
        <input
          type="tel"
          required
          value={contactPhone}
          onChange={(e) => setContactPhone(e.target.value)}
          className="mt-1 w-full rounded-md border border-[var(--color-slate-200)] bg-white px-3 py-2 text-sm"
        />
      </label>
      <label className="block text-sm">
        Email (optional)
        <input
          type="email"
          value={contactEmail}
          onChange={(e) => setContactEmail(e.target.value)}
          className="mt-1 w-full rounded-md border border-[var(--color-slate-200)] bg-white px-3 py-2 text-sm"
        />
      </label>
      <label className="block text-sm">
        Preferred modality
        <select
          value={preferredModality}
          onChange={(e) => setPreferredModality(e.target.value as SessionModality)}
          className="mt-1 w-full rounded-md border border-[var(--color-slate-200)] bg-white px-3 py-2 text-sm"
        >
          <option value="CBT">CBT</option>
          <option value="EMDR">EMDR</option>
          <option value="OTHER">Other</option>
        </select>
      </label>
      <label className="block text-sm">
        Presenting concerns (optional)
        <textarea
          rows={3}
          value={presentingConcerns}
          onChange={(e) => setPresentingConcerns(e.target.value)}
          className="mt-1 w-full rounded-md border border-[var(--color-slate-200)] bg-white px-3 py-2 text-sm"
        />
      </label>
      <p className="text-xs text-[var(--color-slate-500)]">
        AUDIO_RECORDING and AI_NOTE_GENERATION consents (script v1.0) are recorded automatically.
      </p>
      {error && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </div>
      )}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-md bg-[var(--color-navy-700)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? 'Creating…' : 'Create client'}
      </button>
    </form>
  );
}
