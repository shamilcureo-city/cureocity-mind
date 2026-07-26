'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Input } from '../ui/Field';

/**
 * Batch B — record the patient's drug allergies.
 *
 * The Rx pad has printed an "⚠ Allergies" line since DS5 and the live safety
 * rail has had a slot for allergies since DS1, but there was nowhere to put
 * one: no field on the patient, no form, no API. Both surfaces were reading a
 * list that was structurally always empty. This is the missing input.
 *
 * The empty state deliberately says "Not recorded", never "No known
 * allergies" — an unfilled field is not a clearance, and a prescriber must be
 * able to tell the difference at a glance.
 */
export function AllergyEditor({
  clientId,
  initial,
}: {
  clientId: string;
  initial: string[];
}): React.JSX.Element {
  const [allergies, setAllergies] = useState<string[]>(initial);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(next: string[]): Promise<void> {
    setBusy(true);
    setError(null);
    const previous = allergies;
    setAllergies(next);
    try {
      const res = await fetch(`/api/v1/clients/${clientId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ allergies: next }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setAllergies(previous);
        setError(body.error ?? 'Could not save the allergy list.');
      }
    } catch {
      setAllergies(previous);
      setError('Could not save the allergy list — check your connection.');
    } finally {
      setBusy(false);
    }
  }

  function add(e: FormEvent): void {
    e.preventDefault();
    const value = draft.trim();
    if (!value) return;
    if (allergies.some((a) => a.toLowerCase() === value.toLowerCase())) {
      setDraft('');
      return;
    }
    setDraft('');
    void save([...allergies, value]);
  }

  return (
    <section className="mt-8">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
        Drug allergies
      </h2>
      <Card className="p-5">
        {allergies.length === 0 ? (
          <p className="text-sm text-[var(--color-ink-3)]">
            <span className="font-medium text-[var(--color-ink-2)]">Not recorded.</span> This is not
            the same as “no known allergies” — until something is recorded here, prescriptions are
            not checked against anything.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {allergies.map((a) => (
              <li
                key={a}
                className="inline-flex items-center gap-2 rounded-full bg-[var(--color-warn-soft)] px-3 py-1 text-sm font-medium text-[var(--color-warn)]"
              >
                {a}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void save(allergies.filter((x) => x !== a))}
                  className="text-[var(--color-warn)] hover:opacity-70 disabled:opacity-40"
                  aria-label={`Remove ${a}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={add} className="mt-4 flex flex-wrap items-center gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Penicillin, Sulfa drugs, Ibuprofen — rash…"
            aria-label="Add a drug allergy"
            className="max-w-sm flex-1"
          />
          <Button type="submit" size="sm" variant="secondary" disabled={busy || !draft.trim()}>
            Add
          </Button>
        </form>
        {error && <p className="mt-2 text-sm text-[var(--color-warn)]">{error}</p>}
        <p className="mt-3 text-xs text-[var(--color-ink-3)]">
          Every prescription drafted for this patient is checked against this list — by drug and by
          class, so a penicillin allergy also flags amoxicillin.
        </p>
      </Card>
    </section>
  );
}
