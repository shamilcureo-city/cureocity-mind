'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '../ui/Button';
import { Label, Input, Textarea, Select, CheckboxRow, FieldError } from '../ui/Field';
import { Badge } from '../ui/Badge';

const CONCERNS = [
  'Anxiety or constant worry',
  'Low mood or depression',
  'Stress at work or school',
  'Relationship or family',
  'Grief or loss',
  'Trauma or difficult memories',
  'Self-esteem or identity',
  'Sleep difficulties',
  'Anger and irritability',
  'Burnout',
  'Parenting',
  'Something else',
] as const;

const LANGUAGES = [
  'English',
  'Hindi',
  'Tamil',
  'Malayalam',
  'Kannada',
  'Telugu',
  'Marathi',
  'Bengali',
];
const MODALITIES = [
  'No preference',
  'CBT',
  'Psychodynamic',
  'EMDR',
  'ACT',
  'Mindfulness',
  'Couples',
];

const URGENCY_OPTIONS = [
  { value: 'LOW', label: 'No rush', description: 'Within the next month is fine.' },
  { value: 'MEDIUM', label: 'This week ideally', description: 'I would like to start soon.' },
  { value: 'HIGH', label: 'As soon as possible', description: 'Things feel difficult right now.' },
] as const;

interface State {
  concerns: string[];
  notes: string;
  preferredModality: string;
  preferredLanguage: string;
  mode: 'IN_PERSON' | 'ONLINE' | 'EITHER';
  urgency: 'LOW' | 'MEDIUM' | 'HIGH';
  patientName: string;
  patientEmail: string;
  patientPhone: string;
}

const INITIAL: State = {
  concerns: [],
  notes: '',
  preferredModality: '',
  preferredLanguage: '',
  mode: 'EITHER',
  urgency: 'MEDIUM',
  patientName: '',
  patientEmail: '',
  patientPhone: '',
};

const STEPS = ['What is going on', 'Preferences', 'Contact'] as const;

export function IntakeFlow() {
  const [stepIdx, setStepIdx] = useState(0);
  const [state, setState] = useState<State>(INITIAL);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function update<K extends keyof State>(k: K, v: State[K]): void {
    setState((p) => ({ ...p, [k]: v }));
  }

  function toggleConcern(c: string): void {
    setState((p) => ({
      ...p,
      concerns: p.concerns.includes(c) ? p.concerns.filter((x) => x !== c) : [...p.concerns, c],
    }));
  }

  function next(): void {
    setError(null);
    if (stepIdx === 0 && state.concerns.length === 0) {
      setError('Pick at least one. You can change this later.');
      return;
    }
    if (stepIdx < STEPS.length - 1) setStepIdx(stepIdx + 1);
  }

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientName: state.patientName.trim(),
          patientEmail: state.patientEmail.trim(),
          patientPhone: state.patientPhone.trim(),
          concerns: state.concerns,
          notes: state.notes.trim() || undefined,
          preferredModality: state.preferredModality || undefined,
          preferredLanguage: state.preferredLanguage || undefined,
          mode: state.mode,
          urgency: state.urgency,
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

  if (done) return <Done />;

  return (
    <div className="rounded-3xl border border-[var(--color-line)] bg-white p-8 shadow-[0_24px_60px_-32px_rgba(15,27,42,0.18)] sm:p-10">
      <StepRibbon current={stepIdx} />

      {stepIdx === 0 && (
        <fieldset className="mt-10">
          <legend className="font-serif text-3xl leading-tight">
            What is on your mind right now?
          </legend>
          <p className="mt-2 text-[var(--color-ink-2)]">
            Pick anything that sounds close. You can be more specific in a minute.
          </p>
          <div className="mt-7 grid gap-2 sm:grid-cols-2">
            {CONCERNS.map((c) => (
              <CheckboxRow
                key={c}
                id={`concern-${c}`}
                checked={state.concerns.includes(c)}
                onChange={() => toggleConcern(c)}
                label={c}
              />
            ))}
          </div>
          <div className="mt-6">
            <Label htmlFor="notes" hint="Optional">
              Anything more you would like to add?
            </Label>
            <Textarea
              id="notes"
              value={state.notes}
              onChange={(e) => update('notes', e.target.value)}
              placeholder="Whatever helps the right therapist find you."
            />
          </div>
          <FieldError message={error} />
        </fieldset>
      )}

      {stepIdx === 1 && (
        <fieldset className="mt-10">
          <legend className="font-serif text-3xl leading-tight">How do you like to work?</legend>
          <p className="mt-2 text-[var(--color-ink-2)]">
            We will use these to narrow your matches. None of this is binding.
          </p>

          <div className="mt-7 grid gap-5 sm:grid-cols-2">
            <div>
              <Label htmlFor="lang">Preferred language</Label>
              <Select
                id="lang"
                value={state.preferredLanguage}
                onChange={(e) => update('preferredLanguage', e.target.value)}
              >
                <option value="">No preference</option>
                {LANGUAGES.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="mod">Therapy approach</Label>
              <Select
                id="mod"
                value={state.preferredModality}
                onChange={(e) => update('preferredModality', e.target.value)}
              >
                {MODALITIES.map((m) => (
                  <option key={m} value={m === 'No preference' ? '' : m}>
                    {m}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="mt-6">
            <Label>Where would you like to meet?</Label>
            <div className="grid gap-2 sm:grid-cols-3">
              {(['IN_PERSON', 'ONLINE', 'EITHER'] as const).map((m) => (
                <button
                  type="button"
                  key={m}
                  onClick={() => update('mode', m)}
                  className={`rounded-xl border px-4 py-3 text-sm transition-colors ${
                    state.mode === m
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                      : 'border-[var(--color-line)] bg-white text-[var(--color-ink-2)] hover:border-[var(--color-ink-3)]'
                  }`}
                >
                  {m === 'IN_PERSON' ? 'In person' : m === 'ONLINE' ? 'Online' : 'Either is fine'}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-6">
            <Label>How soon would you like to start?</Label>
            <div className="grid gap-2">
              {URGENCY_OPTIONS.map((u) => (
                <CheckboxRow
                  key={u.value}
                  id={`urg-${u.value}`}
                  checked={state.urgency === u.value}
                  onChange={() => update('urgency', u.value)}
                  label={u.label}
                  description={u.description}
                />
              ))}
            </div>
          </div>
          <FieldError message={error} />
        </fieldset>
      )}

      {stepIdx === 2 && (
        <form onSubmit={submit} className="mt-10 space-y-5">
          <h2 className="font-serif text-3xl leading-tight">Where should we send your matches?</h2>
          <p className="text-[var(--color-ink-2)]">
            Only your matched therapists see this. We will not subscribe you to anything.
          </p>
          <div>
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              required
              value={state.patientName}
              onChange={(e) => update('patientName', e.target.value)}
            />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                value={state.patientEmail}
                onChange={(e) => update('patientEmail', e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                type="tel"
                required
                value={state.patientPhone}
                onChange={(e) => update('patientPhone', e.target.value)}
              />
            </div>
          </div>
          <SummaryStrip state={state} />
          <FieldError message={error} />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="secondary" onClick={() => setStepIdx(stepIdx - 1)}>
              Back
            </Button>
            <Button type="submit" disabled={busy} className="flex-1 sm:flex-none">
              {busy ? 'Sending…' : 'Send my matches'}
            </Button>
          </div>
        </form>
      )}

      {stepIdx < 2 && (
        <div className="mt-10 flex flex-wrap items-center gap-3">
          {stepIdx > 0 && (
            <Button variant="secondary" onClick={() => setStepIdx(stepIdx - 1)}>
              Back
            </Button>
          )}
          <Button onClick={next} className="flex-1 sm:flex-none">
            Continue
          </Button>
        </div>
      )}
    </div>
  );
}

function StepRibbon({ current }: { current: number }) {
  return (
    <ol className="flex items-center gap-3">
      {STEPS.map((label, idx) => {
        const done = idx < current;
        const active = idx === current;
        return (
          <li key={label} className="flex flex-1 items-center gap-3">
            <span
              className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-medium ${
                done
                  ? 'bg-[var(--color-accent)] text-white'
                  : active
                    ? 'border border-[var(--color-accent)] text-[var(--color-accent)]'
                    : 'border border-[var(--color-line)] text-[var(--color-ink-3)]'
              }`}
            >
              {done ? '✓' : idx + 1}
            </span>
            <span
              className={`hidden text-xs uppercase tracking-wider sm:inline ${
                active ? 'text-[var(--color-ink)]' : 'text-[var(--color-ink-3)]'
              }`}
            >
              {label}
            </span>
            {idx < STEPS.length - 1 && (
              <span aria-hidden className="h-px flex-1 bg-[var(--color-line)]" />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function SummaryStrip({ state }: { state: State }) {
  const chips = [
    state.concerns.length > 0
      ? `${state.concerns.length} concern${state.concerns.length === 1 ? '' : 's'}`
      : null,
    state.preferredLanguage || null,
    state.preferredModality || null,
    state.mode === 'EITHER'
      ? 'In person or online'
      : state.mode === 'IN_PERSON'
        ? 'In person'
        : 'Online',
    state.urgency === 'HIGH'
      ? 'Urgent'
      : state.urgency === 'MEDIUM'
        ? 'This week'
        : 'Within a month',
  ].filter((x): x is string => x !== null);

  return (
    <div className="rounded-xl bg-[var(--color-surface-soft)] p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-ink-3)]">
        Your intake at a glance
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {chips.map((c) => (
          <Badge key={c} tone="default">
            {c}
          </Badge>
        ))}
      </div>
    </div>
  );
}

function Done() {
  return (
    <div className="rounded-3xl border border-[var(--color-accent)] bg-[var(--color-accent-soft)] p-10 text-center">
      <p className="font-serif text-4xl text-[var(--color-accent)]">Thank you.</p>
      <p className="mx-auto mt-3 max-w-md text-[var(--color-ink-2)]">
        We have got it. A care coordinator is reviewing your intake now. You will hear from us
        within one business day with your three best matches.
      </p>
      <p className="mt-5 text-sm text-[var(--color-ink-3)]">
        Want to browse on your own in the meantime?
      </p>
      <a
        href="/therapists"
        className="mt-2 inline-block text-sm font-medium text-[var(--color-accent)] underline"
      >
        See the directory →
      </a>
    </div>
  );
}
