'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input, Label, Select, Textarea } from '../ui/Field';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated?: (clientId: string) => void;
}

/**
 * Modal form to create a new client. Captures the minimum fields the
 * CreateClientInputSchema requires + records the four DPDP consent
 * scopes (AUDIO_RECORDING + AI_NOTE_GENERATION + CROSS_BORDER_
 * PROCESSING are all required for the scribe pipeline to run;
 * DATA_RETENTION_EXTENDED is opt-in). All consents are recorded as
 * captured IN_PERSON at script v1 — adjust when the consent script
 * versioning surface lands.
 *
 * On success, navigates to the new client's detail page so the
 * therapist can immediately start a session or record a workflow.
 */
export function CreateClientModal({ open, onClose, onCreated }: Props) {
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [contactPhone, setContactPhone] = useState('+91');
  const [contactEmail, setContactEmail] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [presentingConcerns, setPresentingConcerns] = useState('');
  const [preferredModality, setPreferredModality] = useState<'CBT' | 'EMDR' | 'OTHER' | ''>('');
  const [retentionExtended, setRetentionExtended] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const consents: Array<{
        scope: string;
        scriptVersion: string;
        capturedVia: string;
      }> = [
        { scope: 'AUDIO_RECORDING', scriptVersion: 'v1', capturedVia: 'IN_PERSON' },
        { scope: 'AI_NOTE_GENERATION', scriptVersion: 'v1', capturedVia: 'IN_PERSON' },
        { scope: 'CROSS_BORDER_PROCESSING', scriptVersion: 'v1', capturedVia: 'IN_PERSON' },
      ];
      if (retentionExtended) {
        consents.push({
          scope: 'DATA_RETENTION_EXTENDED',
          scriptVersion: 'v1',
          capturedVia: 'IN_PERSON',
        });
      }
      const body: Record<string, unknown> = {
        fullName,
        contactPhone,
        consents,
      };
      if (contactEmail.trim()) body['contactEmail'] = contactEmail.trim();
      if (dateOfBirth) body['dateOfBirth'] = dateOfBirth;
      if (presentingConcerns.trim()) body['presentingConcerns'] = presentingConcerns.trim();
      if (preferredModality) body['preferredModality'] = preferredModality;

      const res = await fetch('/api/v1/clients', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errBody.error ?? `HTTP ${res.status}`);
      }
      const created = (await res.json()) as { id: string };
      onCreated?.(created.id);
      router.push(`/app/clients/${created.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
    >
      <Card className="w-full max-w-xl max-h-[90vh] overflow-y-auto p-7">
        <header className="flex items-baseline justify-between gap-3">
          <h2 className="font-serif text-2xl">New client</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-[var(--color-ink-3)] hover:text-[var(--color-ink)]"
          >
            cancel
          </button>
        </header>

        <form onSubmit={onSubmit} className="mt-4 space-y-4">
          <div>
            <Label htmlFor="cc-name">Full name</Label>
            <Input
              id="cc-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              maxLength={200}
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="cc-phone">Phone</Label>
              <Input
                id="cc-phone"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                required
                placeholder="+919876543210"
              />
            </div>
            <div>
              <Label htmlFor="cc-email" hint="optional">
                Email
              </Label>
              <Input
                id="cc-email"
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="cc-dob" hint="optional">
                Date of birth
              </Label>
              <Input
                id="cc-dob"
                type="date"
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="cc-modality" hint="optional">
                Preferred modality
              </Label>
              <Select
                id="cc-modality"
                value={preferredModality}
                onChange={(e) =>
                  setPreferredModality(e.target.value as 'CBT' | 'EMDR' | 'OTHER' | '')
                }
              >
                <option value="">—</option>
                <option value="CBT">CBT</option>
                <option value="EMDR">EMDR</option>
                <option value="OTHER">Other</option>
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="cc-concerns" hint="optional · 0–2000 chars">
              Presenting concerns
            </Label>
            <Textarea
              id="cc-concerns"
              rows={3}
              value={presentingConcerns}
              onChange={(e) => setPresentingConcerns(e.target.value)}
            />
          </div>

          <fieldset className="rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] p-4">
            <legend className="px-2 text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
              Consents
            </legend>
            <p className="text-xs text-[var(--color-ink-2)]">
              Audio recording, AI note generation, and cross-border processing are all required
              for the scribe pipeline to run. Confirm the client has granted each in person.
            </p>
            <ul className="mt-2 space-y-1 text-xs text-[var(--color-ink)]">
              <li>✓ AUDIO_RECORDING</li>
              <li>✓ AI_NOTE_GENERATION</li>
              <li>✓ CROSS_BORDER_PROCESSING</li>
            </ul>
            <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs text-[var(--color-ink)]">
              <input
                type="checkbox"
                checked={retentionExtended}
                onChange={(e) => setRetentionExtended(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]"
              />
              <span>
                Client also consented to extended data retention beyond 30 days
                (DATA_RETENTION_EXTENDED — optional).
              </span>
            </label>
          </fieldset>

          {error && <p className="text-sm text-[var(--color-warn)]">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Creating…' : 'Create client'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
