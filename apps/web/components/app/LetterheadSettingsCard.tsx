'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Input, Label } from '../ui/Field';

/**
 * Batch F — the prescription letterhead.
 *
 * `RxPadPdf` has rendered a clinic line since DS5-fu and the route has always
 * passed `clinicName: null`, so every prescription a doctor printed or shared
 * went out with a blank header — no clinic, no address, no phone. In Indian
 * OPD practice the prescription IS the clinic's document: a pharmacist checks
 * it, and a patient uses it to find their way back. This is where a doctor
 * fills it in.
 *
 * Everything is optional. A doctor who saves nothing gets exactly the
 * previous output.
 */
export function LetterheadSettingsCard({
  initial,
}: {
  initial: { clinicName: string | null; clinicAddress: string | null; clinicPhone: string | null };
}): React.JSX.Element {
  const [clinicName, setClinicName] = useState(initial.clinicName ?? '');
  const [clinicAddress, setClinicAddress] = useState(initial.clinicAddress ?? '');
  const [clinicPhone, setClinicPhone] = useState(initial.clinicPhone ?? '');
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent): Promise<void> {
    e.preventDefault();
    setState('saving');
    setError(null);
    try {
      const res = await fetch('/api/v1/psychologists/me', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          // Empty means "not set", which is null on the record — not "".
          clinicName: clinicName.trim() || null,
          clinicAddress: clinicAddress.trim() || null,
          clinicPhone: clinicPhone.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? 'Could not save the letterhead.');
        setState('idle');
        return;
      }
      setState('saved');
    } catch {
      setError('Could not save the letterhead — check your connection.');
      setState('idle');
    }
  }

  return (
    <Card className="p-6">
      <h2 className="font-serif text-xl">Prescription letterhead</h2>
      <p className="mt-1 text-sm text-[var(--color-ink-2)]">
        Printed at the top of every prescription PDF you share, above your name and registration
        number. Leave a line blank to omit it.
      </p>

      <form onSubmit={save} className="mt-5 space-y-4">
        <div>
          <Label htmlFor="lh-name">Clinic or hospital name</Label>
          <Input
            id="lh-name"
            value={clinicName}
            onChange={(e) => {
              setClinicName(e.target.value);
              setState('idle');
            }}
            placeholder="Cureocity Clinic"
            maxLength={160}
          />
        </div>
        <div>
          <Label htmlFor="lh-address">Address</Label>
          <textarea
            id="lh-address"
            value={clinicAddress}
            onChange={(e) => {
              setClinicAddress(e.target.value);
              setState('idle');
            }}
            rows={2}
            maxLength={500}
            placeholder="2nd Floor, MG Road, Kochi 682016"
            className="mt-1 w-full rounded-xl border border-[var(--color-line)] bg-white p-2.5 text-sm text-[var(--color-ink)] focus:border-[var(--color-accent)] focus:outline-none"
          />
        </div>
        <div>
          <Label htmlFor="lh-phone">Clinic phone</Label>
          <Input
            id="lh-phone"
            value={clinicPhone}
            onChange={(e) => {
              setClinicPhone(e.target.value);
              setState('idle');
            }}
            placeholder="0484 123 4567"
            maxLength={40}
          />
        </div>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={state === 'saving'}>
            {state === 'saving' ? 'Saving…' : 'Save letterhead'}
          </Button>
          {state === 'saved' && <span className="text-sm text-[var(--color-accent)]">✓ Saved</span>}
          {error && <span className="text-sm text-[var(--color-warn)]">{error}</span>}
        </div>
      </form>
    </Card>
  );
}
