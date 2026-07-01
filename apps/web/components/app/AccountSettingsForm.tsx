'use client';

import { useCallback, useState } from 'react';
import type { Psychologist } from '@cureocity/contracts';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

interface Props {
  initial: Psychologist;
}

interface FormState {
  fullName: string;
  headline: string;
  bio: string;
  photoUrl: string;
  specialties: string;
  languages: string;
  modalities: string;
  yearsOfExperience: string;
  locationCity: string;
  locationProvince: string;
  sessionFeeInr: string;
  isAcceptingNewClients: boolean;
  backupEmail: string;
}

function fromPsy(p: Psychologist): FormState {
  return {
    fullName: p.fullName,
    headline: p.headline ?? '',
    bio: p.bio ?? '',
    photoUrl: p.photoUrl ?? '',
    specialties: p.specialties.join(', '),
    languages: p.languages.join(', '),
    modalities: p.modalities.join(', '),
    yearsOfExperience: p.yearsOfExperience !== null ? String(p.yearsOfExperience) : '',
    locationCity: p.locationCity ?? '',
    locationProvince: p.locationProvince ?? '',
    sessionFeeInr: p.sessionFeeInr !== null ? String(p.sessionFeeInr) : '',
    isAcceptingNewClients: p.isAcceptingNewClients,
    backupEmail: p.backupEmail ?? '',
  };
}

function diffPayload(initial: Psychologist, form: FormState): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  const csvOrNull = (s: string) =>
    s
      .split(',')
      .map((x) => x.trim())
      .filter((x) => x.length > 0);
  const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s));
  const strOrNull = (s: string) => (s.trim() === '' ? null : s.trim());

  if (form.fullName !== initial.fullName) payload['fullName'] = form.fullName.trim();
  if (form.headline !== (initial.headline ?? '')) payload['headline'] = strOrNull(form.headline);
  if (form.bio !== (initial.bio ?? '')) payload['bio'] = strOrNull(form.bio);
  if (form.photoUrl !== (initial.photoUrl ?? '')) payload['photoUrl'] = strOrNull(form.photoUrl);
  const nextSpec = csvOrNull(form.specialties);
  if (JSON.stringify(nextSpec) !== JSON.stringify(initial.specialties)) {
    payload['specialties'] = nextSpec;
  }
  const nextLangs = csvOrNull(form.languages);
  if (JSON.stringify(nextLangs) !== JSON.stringify(initial.languages)) {
    payload['languages'] = nextLangs;
  }
  const nextMods = csvOrNull(form.modalities);
  if (JSON.stringify(nextMods) !== JSON.stringify(initial.modalities)) {
    payload['modalities'] = nextMods;
  }
  const yoe = numOrNull(form.yearsOfExperience);
  if (yoe !== initial.yearsOfExperience) payload['yearsOfExperience'] = yoe;
  if (form.locationCity !== (initial.locationCity ?? '')) {
    payload['locationCity'] = strOrNull(form.locationCity);
  }
  if (form.locationProvince !== (initial.locationProvince ?? '')) {
    payload['locationProvince'] = strOrNull(form.locationProvince);
  }
  const fee = numOrNull(form.sessionFeeInr);
  if (fee !== initial.sessionFeeInr) payload['sessionFeeInr'] = fee;
  if (form.isAcceptingNewClients !== initial.isAcceptingNewClients) {
    payload['isAcceptingNewClients'] = form.isAcceptingNewClients;
  }
  if (form.backupEmail !== (initial.backupEmail ?? '')) {
    payload['backupEmail'] = strOrNull(form.backupEmail);
  }
  return payload;
}

export function AccountSettingsForm({ initial }: Props) {
  const [state, setState] = useState<FormState>(() => fromPsy(initial));
  const [original, setOriginal] = useState<Psychologist>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const onChange = useCallback(<K extends keyof FormState>(k: K, v: FormState[K]) => {
    setState((s) => ({ ...s, [k]: v }));
    setSaved(false);
  }, []);

  const dirty = Object.keys(diffPayload(original, state)).length > 0;

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const payload = diffPayload(original, state);
      if (Object.keys(payload).length === 0) {
        return;
      }
      const res = await fetch('/api/v1/psychologists/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as {
        psychologist?: Psychologist;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (data.psychologist) {
        setOriginal(data.psychologist);
        setState(fromPsy(data.psychologist));
      }
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [original, state]);

  return (
    <Card className="p-6">
      <header className="mb-4">
        <h2 className="font-serif text-2xl">Account</h2>
        <p className="mt-1 text-sm text-[var(--color-ink-2)]">
          What clients see and how you appear in the directory. Email, phone, and RCI number are
          managed separately for verification.
        </p>
      </header>

      <div className="space-y-4">
        <Field label="Full name" required>
          <input
            type="text"
            value={state.fullName}
            onChange={(e) => onChange('fullName', e.target.value)}
            className="w-full rounded-xl border border-[var(--color-line-soft)] bg-white/40 p-3 text-sm"
          />
        </Field>
        <Field label="Headline" hint="One-line tagline shown in the directory">
          <input
            type="text"
            value={state.headline}
            onChange={(e) => onChange('headline', e.target.value)}
            className="w-full rounded-xl border border-[var(--color-line-soft)] bg-white/40 p-3 text-sm"
            placeholder="e.g. CBT for adult anxiety + EMDR for trauma"
          />
        </Field>
        <Field label="Bio" hint="Markdown supported in the directory render">
          <textarea
            value={state.bio}
            onChange={(e) => onChange('bio', e.target.value)}
            rows={5}
            className="w-full rounded-xl border border-[var(--color-line-soft)] bg-white/40 p-3 text-sm"
          />
        </Field>
        <Field label="Photo URL" hint="Public direct link to a square image">
          <input
            type="url"
            value={state.photoUrl}
            onChange={(e) => onChange('photoUrl', e.target.value)}
            className="w-full rounded-xl border border-[var(--color-line-soft)] bg-white/40 p-3 text-sm"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Specialties" hint="Comma-separated">
            <input
              type="text"
              value={state.specialties}
              onChange={(e) => onChange('specialties', e.target.value)}
              className="w-full rounded-xl border border-[var(--color-line-soft)] bg-white/40 p-3 text-sm"
              placeholder="e.g. anxiety, panic, work stress"
            />
          </Field>
          <Field label="Languages" hint="Comma-separated">
            <input
              type="text"
              value={state.languages}
              onChange={(e) => onChange('languages', e.target.value)}
              className="w-full rounded-xl border border-[var(--color-line-soft)] bg-white/40 p-3 text-sm"
              placeholder="e.g. English, Malayalam"
            />
          </Field>
          <Field label="Modalities" hint="Comma-separated">
            <input
              type="text"
              value={state.modalities}
              onChange={(e) => onChange('modalities', e.target.value)}
              className="w-full rounded-xl border border-[var(--color-line-soft)] bg-white/40 p-3 text-sm"
              placeholder="e.g. CBT, EMDR"
            />
          </Field>
          <Field label="Years of experience">
            <input
              type="number"
              value={state.yearsOfExperience}
              onChange={(e) => onChange('yearsOfExperience', e.target.value)}
              className="w-full rounded-xl border border-[var(--color-line-soft)] bg-white/40 p-3 text-sm"
              min={0}
              max={80}
            />
          </Field>
          <Field label="City">
            <input
              type="text"
              value={state.locationCity}
              onChange={(e) => onChange('locationCity', e.target.value)}
              className="w-full rounded-xl border border-[var(--color-line-soft)] bg-white/40 p-3 text-sm"
            />
          </Field>
          <Field label="State / Province">
            <input
              type="text"
              value={state.locationProvince}
              onChange={(e) => onChange('locationProvince', e.target.value)}
              className="w-full rounded-xl border border-[var(--color-line-soft)] bg-white/40 p-3 text-sm"
            />
          </Field>
          <Field label="Session fee (INR)">
            <input
              type="number"
              value={state.sessionFeeInr}
              onChange={(e) => onChange('sessionFeeInr', e.target.value)}
              className="w-full rounded-xl border border-[var(--color-line-soft)] bg-white/40 p-3 text-sm"
              min={0}
            />
          </Field>
          <Field label="Backup email" hint="Used for account recovery if phone OTP fails">
            <input
              type="email"
              value={state.backupEmail}
              onChange={(e) => onChange('backupEmail', e.target.value)}
              className="w-full rounded-xl border border-[var(--color-line-soft)] bg-white/40 p-3 text-sm"
            />
          </Field>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={state.isAcceptingNewClients}
            onChange={(e) => onChange('isAcceptingNewClients', e.target.checked)}
            className="h-4 w-4"
          />
          <span>Accepting new clients</span>
        </label>
      </div>

      {error && (
        <div className="mt-4 rounded-2xl border border-[var(--color-warn-border)] bg-[var(--color-warn-bg)] p-3 text-sm text-[var(--color-warn)]">
          {error}
        </div>
      )}
      {saved && (
        <div className="mt-4 rounded-2xl border border-[var(--color-accent)] bg-[var(--color-accent-soft)] p-3 text-sm text-[var(--color-ink)]">
          Profile saved.
        </div>
      )}

      <div className="mt-6 flex justify-end border-t border-[var(--color-line-soft)] pt-4">
        <Button onClick={() => void submit()} disabled={busy || !dirty}>
          {busy ? 'Saving…' : 'Save profile'}
        </Button>
      </div>
    </Card>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
        {label}
        {required && <span className="ml-1 text-[var(--color-accent)]">*</span>}
        {hint && (
          <span className="ml-2 normal-case text-[10px] text-[var(--color-ink-3)]">{hint}</span>
        )}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
