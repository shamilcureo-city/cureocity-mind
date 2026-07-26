'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PublicSlot, PublicSlotsResponse } from '@cureocity/contracts';
import { Button } from '../ui/Button';

/**
 * Marketing V1 — the public appointment widget. Loads the live slot
 * feed for a published profile, groups it by IST day, and submits an
 * appointment request against a concrete slot.
 *
 * A 409 on submit means the slot was taken while the visitor decided —
 * the feed reloads and the message says exactly that.
 */

interface Props {
  slug: string;
  therapistName: string;
  acceptingNewClients: boolean;
  /// MK2 — shown when the chosen slot is an in-person window.
  officeAddress?: string | null;
}

const IST_DAY = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});
const IST_TIME = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});
const IST_SHORT = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  weekday: 'short',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});
const IST_FULL = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

export function AppointmentWidget({
  slug,
  therapistName,
  acceptingNewClients,
  officeAddress,
}: Props) {
  const [slots, setSlots] = useState<PublicSlot[] | null>(null);
  const [hasAvailability, setHasAvailability] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [concern, setConcern] = useState('');
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/public/therapists/${slug}/slots`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as PublicSlotsResponse;
      setSlots(body.slots);
      setHasAvailability(body.hasAvailability);
    } catch {
      setSlots([]);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedSlot = useMemo(
    () => (slots ?? []).find((s) => s.startAt === selected) ?? null,
    [slots, selected],
  );

  const byDay = useMemo(() => {
    const groups = new Map<string, PublicSlot[]>();
    for (const s of slots ?? []) {
      const day = IST_DAY.format(new Date(s.startAt));
      groups.set(day, [...(groups.get(day) ?? []), s]);
    }
    return [...groups.entries()];
  }, [slots]);

  const submit = useCallback(async () => {
    if (!selected || !consent) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/public/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          startAt: selected,
          patientName: name.trim(),
          patientPhone: phone.trim(),
          ...(email.trim() && { patientEmail: email.trim() }),
          ...(concern.trim() && { concern: concern.trim() }),
          consentContact: true,
        }),
      });
      if (res.status === 409) {
        setSelected(null);
        await load();
        throw new Error('That time was just taken — please pick another slot.');
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'Something went wrong — please try again.');
      }
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }, [selected, consent, slug, name, phone, email, concern, load]);

  if (!acceptingNewClients) {
    return (
      <p className="rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] p-5 text-sm text-[var(--color-ink-2)]">
        {therapistName} is not accepting new clients at the moment.
      </p>
    );
  }

  if (done && selected) {
    return (
      <div className="rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-6">
        <h3 className="font-serif text-xl">Request sent</h3>
        <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-2)]">
          Your appointment request for{' '}
          <strong className="text-[var(--color-ink)]">
            {IST_FULL.format(new Date(selected))} (IST)
          </strong>{' '}
          is with {therapistName}. The time is held for you — you&rsquo;ll hear back on the phone
          number you shared once it&rsquo;s confirmed.
        </p>
      </div>
    );
  }

  if (slots === null) {
    return <p className="text-sm text-[var(--color-ink-3)]">Loading available times…</p>;
  }

  if (!hasAvailability || slots.length === 0) {
    return (
      <p className="rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] p-5 text-sm text-[var(--color-ink-2)]">
        No online slots are open right now. Check back soon.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <div className="space-y-4">
        {byDay.map(([day, daySlots]) => (
          <div key={day}>
            <h4 className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-3)]">
              {day}
            </h4>
            <div className="mt-2 flex flex-wrap gap-2">
              {daySlots.map((s) => (
                <button
                  key={s.startAt}
                  type="button"
                  onClick={() => setSelected(s.startAt)}
                  className={`rounded-full border px-4 py-1.5 text-sm transition-colors ${
                    selected === s.startAt
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-white'
                      : 'border-[var(--color-line-soft)] bg-[var(--color-surface)] hover:border-[var(--color-accent)]'
                  }`}
                >
                  {IST_TIME.format(new Date(s.startAt))}
                  {s.mode === 'IN_PERSON' && (
                    <span className="ml-1 opacity-70" title="In person at the clinic">
                      · clinic
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {selected && (
        <form
          className="space-y-3 rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-5"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <p className="text-sm text-[var(--color-ink-2)]">
            Requesting <strong>{IST_FULL.format(new Date(selected))}</strong> (IST)
            {selectedSlot?.mode === 'IN_PERSON' ? (
              <span className="mt-0.5 block text-xs text-[var(--color-ink-3)]">
                In person{officeAddress ? ` · ${officeAddress}` : ' at the clinic'}
              </span>
            ) : (
              <span className="mt-0.5 block text-xs text-[var(--color-ink-3)]">Online session</span>
            )}
          </p>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            className="w-full rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-bg)] px-4 py-2.5 text-sm"
          />
          <input
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Phone (WhatsApp preferred)"
            inputMode="tel"
            className="w-full rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-bg)] px-4 py-2.5 text-sm"
          />
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email (optional)"
            type="email"
            className="w-full rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-bg)] px-4 py-2.5 text-sm"
          />
          <textarea
            value={concern}
            onChange={(e) => setConcern(e.target.value)}
            placeholder="What would you like help with? (optional, private)"
            rows={3}
            maxLength={500}
            className="w-full rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-bg)] px-4 py-2.5 text-sm"
          />
          <label className="flex items-start gap-2 text-xs text-[var(--color-ink-2)]">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5"
            />
            I consent to {therapistName} contacting me about this request. What I share here is sent
            privately and stored encrypted.
          </label>
          {error && <p className="text-sm text-[var(--color-warn)]">{error}</p>}
          {/* MK2 — the submit rides a sticky bar on phones so the chosen
              slot + action stay in thumb reach while the form scrolls. */}
          <div className="sticky bottom-0 -mx-5 -mb-5 border-t border-[var(--color-line-soft)] bg-[var(--color-surface)] px-5 py-3 sm:static sm:m-0 sm:border-0 sm:p-0">
            <Button
              type="submit"
              disabled={submitting || !consent || !name.trim() || !phone.trim()}
              className="w-full sm:w-auto"
            >
              {submitting ? 'Sending…' : `Request ${IST_SHORT.format(new Date(selected))}`}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
