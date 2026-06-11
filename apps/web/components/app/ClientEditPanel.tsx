'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input, Label, Select, Textarea } from '../ui/Field';
import { SpokenLanguageChips } from './SpokenLanguageChips';

export interface ClientEditValues {
  id: string;
  fullName: string;
  contactPhone: string;
  contactEmail: string | null;
  /** ISO date (YYYY-MM-DD) or null. */
  dateOfBirth: string | null;
  presentingConcerns: string | null;
  preferredLanguage: string;
  spokenLanguages: string[];
}

/**
 * Sprint 44 — edit a client's record after intake.
 *
 * The new-client form deliberately captures only name + phone +
 * consents and tells the therapist to "add the rest later from the
 * client page". This panel is that path: it wires the existing
 * PATCH /api/v1/clients/[id] (which already audits before+after) so
 * email, date of birth, languages and presenting concerns are no
 * longer a dead end. Renders an Edit button + a modal pre-filled with
 * the current values; refreshes the page on save.
 */
export function ClientEditPanel({ client }: { client: ClientEditValues }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState(client.fullName);
  const [contactPhone, setContactPhone] = useState(client.contactPhone);
  const [contactEmail, setContactEmail] = useState(client.contactEmail ?? '');
  const [dateOfBirth, setDateOfBirth] = useState(client.dateOfBirth ?? '');
  const [presentingConcerns, setPresentingConcerns] = useState(client.presentingConcerns ?? '');
  const [preferredLanguage, setPreferredLanguage] = useState(client.preferredLanguage);
  const [spokenLanguages, setSpokenLanguages] = useState<string[]>(client.spokenLanguages);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setFullName(client.fullName);
    setContactPhone(client.contactPhone);
    setContactEmail(client.contactEmail ?? '');
    setDateOfBirth(client.dateOfBirth ?? '');
    setPresentingConcerns(client.presentingConcerns ?? '');
    setPreferredLanguage(client.preferredLanguage);
    setSpokenLanguages(client.spokenLanguages);
    setError(null);
  }

  function close() {
    reset();
    setOpen(false);
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // Send the full editable set; the route diffs + audits before/after.
      const body = {
        fullName,
        contactPhone,
        contactEmail: contactEmail.trim() ? contactEmail.trim() : null,
        dateOfBirth: dateOfBirth ? dateOfBirth : null,
        presentingConcerns: presentingConcerns.trim() ? presentingConcerns.trim() : null,
        preferredLanguage,
        spokenLanguages,
      };
      const res = await fetch(`/api/v1/clients/${client.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errBody.error ?? `HTTP ${res.status}`);
      }
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Edit
      </Button>
      {open && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="client-edit-title"
        >
          <Card className="max-h-[90vh] w-full max-w-xl overflow-y-auto p-7">
            <header className="flex items-baseline justify-between gap-3">
              <h2 id="client-edit-title" className="font-serif text-2xl">
                Edit client
              </h2>
              <button
                type="button"
                onClick={close}
                className="text-sm text-[var(--color-ink-3)] hover:text-[var(--color-ink)]"
              >
                cancel
              </button>
            </header>

            <form onSubmit={onSubmit} className="mt-4 space-y-4">
              <div>
                <Label htmlFor="ce-name">Full name</Label>
                <Input
                  id="ce-name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                  maxLength={200}
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="ce-phone">Phone</Label>
                  <Input
                    id="ce-phone"
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    required
                    placeholder="+919876543210"
                  />
                </div>
                <div>
                  <Label htmlFor="ce-email" hint="optional">
                    Email
                  </Label>
                  <Input
                    id="ce-email"
                    type="email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="ce-dob" hint="optional">
                    Date of birth
                  </Label>
                  <Input
                    id="ce-dob"
                    type="date"
                    value={dateOfBirth}
                    onChange={(e) => setDateOfBirth(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="ce-pref-lang" hint="patient-facing">
                    Preferred language
                  </Label>
                  <Select
                    id="ce-pref-lang"
                    value={preferredLanguage}
                    onChange={(e) => setPreferredLanguage(e.target.value)}
                  >
                    <option value="en">English</option>
                    <option value="ml">Malayalam (മലയാളം)</option>
                    <option value="hi">Hindi (हिन्दी)</option>
                    <option value="ta">Tamil (தமிழ்)</option>
                    <option value="bn">Bengali (বাংলা)</option>
                  </Select>
                </div>
              </div>

              <div>
                <Label htmlFor="ce-spoken-langs" hint="optional · multi-select">
                  Typical spoken languages
                </Label>
                <SpokenLanguageChips value={spokenLanguages} onChange={setSpokenLanguages} />
                <p className="mt-1 text-xs text-[var(--color-ink-3)]">
                  Transcription hint. Pick more than one for code-mixed speakers (Manglish: ml + en).
                </p>
              </div>

              <div>
                <Label htmlFor="ce-concerns" hint="optional · 0–2000 chars">
                  Presenting concerns
                </Label>
                <Textarea
                  id="ce-concerns"
                  rows={3}
                  value={presentingConcerns}
                  onChange={(e) => setPresentingConcerns(e.target.value)}
                />
              </div>

              {error && <p className="text-sm text-[var(--color-warn)]">{error}</p>}

              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={close} disabled={submitting}>
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? 'Saving…' : 'Save changes'}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </>
  );
}
