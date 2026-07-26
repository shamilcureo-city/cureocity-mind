'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Input, Label } from '../ui/Field';

/**
 * Batch F — type in the vitals the nurse measured.
 *
 * Vitals could only ever reach the record by being SPOKEN aloud, because
 * Pass 2 extracts them from the transcript. In an Indian OPD the nurse
 * measures BP and weight at triage and hands over a slip; nobody says the
 * numbers out loud, so they were lost — and the chronic-disease trajectory
 * the Journey engine plots went hungry with them.
 */
export function VitalsEntryCard({ sessionId }: { sessionId: string }): React.JSX.Element {
  const [systolic, setSystolic] = useState('');
  const [diastolic, setDiastolic] = useState('');
  const [weight, setWeight] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState<string | null>(null);

  const dirty = systolic !== '' || diastolic !== '' || weight !== '';

  async function save(e: FormEvent): Promise<void> {
    e.preventDefault();
    setState('saving');
    setError(null);
    const num = (v: string): number | null => {
      const n = Number(v.trim());
      return v.trim() !== '' && Number.isFinite(n) ? n : null;
    };
    try {
      const res = await fetch(`/api/v1/sessions/${sessionId}/vitals`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          bpSystolic: num(systolic),
          bpDiastolic: num(diastolic),
          weightKg: num(weight),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? 'Could not save the vitals.');
        setState('idle');
        return;
      }
      setState('saved');
    } catch {
      setError('Could not save the vitals — check your connection.');
      setState('idle');
    }
  }

  return (
    <Card className="p-5">
      <p className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--color-ink-3)]">
        Vitals
      </p>
      <p className="mt-1 text-sm text-[var(--color-ink-2)]">
        Anything measured at triage rather than said out loud. These feed the patient&rsquo;s BP and
        weight trend.
      </p>
      <form onSubmit={save} className="mt-4 flex flex-wrap items-end gap-3">
        <div className="w-24">
          <Label htmlFor="v-sys">BP systolic</Label>
          <Input
            id="v-sys"
            inputMode="numeric"
            value={systolic}
            onChange={(e) => {
              setSystolic(e.target.value);
              setState('idle');
            }}
            placeholder="140"
          />
        </div>
        <div className="w-24">
          <Label htmlFor="v-dia">Diastolic</Label>
          <Input
            id="v-dia"
            inputMode="numeric"
            value={diastolic}
            onChange={(e) => {
              setDiastolic(e.target.value);
              setState('idle');
            }}
            placeholder="90"
          />
        </div>
        <div className="w-28">
          <Label htmlFor="v-wt">Weight (kg)</Label>
          <Input
            id="v-wt"
            inputMode="decimal"
            value={weight}
            onChange={(e) => {
              setWeight(e.target.value);
              setState('idle');
            }}
            placeholder="72.5"
          />
        </div>
        <Button type="submit" size="sm" variant="secondary" disabled={!dirty || state === 'saving'}>
          {state === 'saving' ? 'Saving…' : 'Record'}
        </Button>
        {state === 'saved' && (
          <span className="text-sm text-[var(--color-accent)]">✓ Recorded</span>
        )}
        {error && <span className="text-sm text-[var(--color-warn)]">{error}</span>}
      </form>
    </Card>
  );
}
