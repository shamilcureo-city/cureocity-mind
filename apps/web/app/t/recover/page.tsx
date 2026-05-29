'use client';

import { useState, type FormEvent } from 'react';

/**
 * Account recovery (gap G8 — backup email OTP flow).
 *
 * V1 scaffold: collects backup email, says "we'll send a recovery
 * link." Actual email-OTP wiring lives in patient-model-service +
 * Firebase Auth's email link flow; ships in Sprint 7 after Sharafath
 * confirms the recovery channel (email vs WhatsApp magic-link).
 */
export default function RecoverPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    // TODO(Sprint 7): POST /api/v1/account-recovery/start with email
    setSent(true);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold text-[var(--color-navy-700)]">
          Recover your account
        </h1>
        <p className="mt-2 text-sm text-[var(--color-slate-500)]">
          Enter the backup email you registered when you signed up. We&apos;ll send a one-time link.
        </p>
      </header>

      {sent ? (
        <div className="rounded-md border border-[var(--color-slate-200)] bg-white px-4 py-3 text-sm">
          If a Cureocity Mind account exists for <strong>{email}</strong>, a recovery link is on its
          way. Check your inbox (and spam folder) within a few minutes.
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block text-sm font-medium text-[var(--color-slate-900)]">
            Backup email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="mt-1 w-full rounded-md border border-[var(--color-slate-200)] bg-white px-3 py-2 text-sm focus:border-[var(--color-navy-500)] focus:outline-none"
            />
          </label>
          <button
            type="submit"
            className="w-full rounded-md bg-[var(--color-navy-700)] px-4 py-2 text-sm font-medium text-white"
          >
            Send recovery link
          </button>
          <p className="text-center text-xs text-[var(--color-slate-500)]">
            <a href="/t/login" className="underline">
              Back to sign-in
            </a>
          </p>
        </form>
      )}
    </main>
  );
}
