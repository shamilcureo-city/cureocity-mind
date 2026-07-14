'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';

/**
 * P3 — the Care landing's waitlist capture. Sign-ups stay gated until
 * the launch blockers clear; this is the front door's CTA meanwhile.
 * Inherits the page's (night) tokens — no colors of its own.
 */
export function CareWaitlistForm() {
  const [contact, setContact] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (state === 'busy' || contact.trim().length < 5) return;
    setState('busy');
    try {
      const res = await fetch('/api/v1/care/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact: contact.trim() }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setState('done');
    } catch {
      setState('error');
    }
  }

  if (state === 'done') {
    return (
      <p className="rounded-2xl border border-[var(--color-accent)]/40 bg-[var(--color-accent-soft)] px-5 py-4 text-sm text-[var(--color-ink)]">
        You&rsquo;re on the list. We&rsquo;ll message you the moment sessions open — and nothing
        else.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="flex w-full max-w-md flex-col gap-2 sm:flex-row">
      <label htmlFor="care-waitlist-contact" className="sr-only">
        Phone or email
      </label>
      <input
        id="care-waitlist-contact"
        type="text"
        inputMode="email"
        autoComplete="email"
        required
        minLength={5}
        maxLength={200}
        placeholder="Phone or email"
        value={contact}
        onChange={(e) => setContact(e.target.value)}
        className="flex-1 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-3)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
      />
      <Button type="submit" size="lg" disabled={state === 'busy'}>
        {state === 'busy' ? 'Joining…' : 'Join the waitlist'}
      </Button>
      {state === 'error' ? (
        <p className="text-xs text-[var(--color-ink-3)] sm:self-center">
          Didn&rsquo;t go through — try again.
        </p>
      ) : null}
    </form>
  );
}
