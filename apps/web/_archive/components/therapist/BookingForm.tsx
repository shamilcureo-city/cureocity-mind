'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '../ui/Button';
import { Label, Input, Textarea, FieldError } from '../ui/Field';

interface Props {
  therapistId: string;
  therapistName: string;
}

interface FormState {
  patientName: string;
  patientEmail: string;
  patientPhone: string;
  preferredAt: string;
  message: string;
}

const INITIAL: FormState = {
  patientName: '',
  patientEmail: '',
  patientPhone: '',
  preferredAt: '',
  message: '',
};

export function BookingForm({ therapistId, therapistName }: Props) {
  const [form, setForm] = useState<FormState>(INITIAL);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function setField<K extends keyof FormState>(key: K) {
    return (value: FormState[K]) => setForm((p) => ({ ...p, [key]: value }));
  }

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          therapistId,
          patientName: form.patientName.trim(),
          patientEmail: form.patientEmail.trim(),
          patientPhone: form.patientPhone.trim(),
          preferredAt: new Date(form.preferredAt).toISOString(),
          message: form.message.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-[var(--color-accent)] bg-[var(--color-accent-soft)] p-6">
        <p className="font-serif text-xl text-[var(--color-accent)]">
          Request sent to {therapistName}.
        </p>
        <p className="mt-2 text-sm text-[var(--color-ink-2)]">
          You will hear back within one business day on the email or phone you shared. We will not
          charge anything until you confirm a session.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div>
        <Label htmlFor="patientName">Your name</Label>
        <Input
          id="patientName"
          required
          value={form.patientName}
          onChange={(e) => setField('patientName')(e.target.value)}
          placeholder="Anika Sharma"
        />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <Label htmlFor="patientEmail">Email</Label>
          <Input
            id="patientEmail"
            type="email"
            required
            value={form.patientEmail}
            onChange={(e) => setField('patientEmail')(e.target.value)}
            placeholder="anika@example.com"
          />
        </div>
        <div>
          <Label htmlFor="patientPhone">Phone</Label>
          <Input
            id="patientPhone"
            type="tel"
            required
            value={form.patientPhone}
            onChange={(e) => setField('patientPhone')(e.target.value)}
            placeholder="+91 98765 43210"
          />
        </div>
      </div>
      <div>
        <Label htmlFor="preferredAt" hint="Pick a day and time that works for you">
          Preferred time for the intro call
        </Label>
        <Input
          id="preferredAt"
          type="datetime-local"
          required
          value={form.preferredAt}
          onChange={(e) => setField('preferredAt')(e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="message" hint="Optional">
          Anything {therapistName.split(' ')[0]} should know in advance?
        </Label>
        <Textarea
          id="message"
          value={form.message}
          onChange={(e) => setField('message')(e.target.value)}
          placeholder="What you would like help with, work hours, language preferences…"
        />
      </div>
      <FieldError message={error} />
      <Button type="submit" size="lg" className="w-full" disabled={busy}>
        {busy ? 'Sending…' : 'Request an introductory call'}
      </Button>
      <p className="text-center text-xs text-[var(--color-ink-3)]">
        Free 15-minute call. No card required. Reply within 1 business day.
      </p>
    </form>
  );
}
