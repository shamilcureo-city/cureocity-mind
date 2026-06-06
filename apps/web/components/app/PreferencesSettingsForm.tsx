'use client';

import { useCallback, useState } from 'react';
import type { Psychologist, SessionModality } from '@cureocity/contracts';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

interface Props {
  initial: Psychologist;
}

export function PreferencesSettingsForm({ initial }: Props) {
  const [language, setLanguage] = useState(initial.defaultOutputLanguage);
  const [modality, setModality] = useState<SessionModality | ''>(
    (initial.defaultModality as SessionModality | null) ?? '',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const payload: Record<string, unknown> = {};
      if (language !== initial.defaultOutputLanguage) {
        payload['defaultOutputLanguage'] = language;
      }
      if ((modality || null) !== initial.defaultModality) {
        payload['defaultModality'] = modality || null;
      }
      if (Object.keys(payload).length === 0) {
        setError('No changes to save.');
        return;
      }
      const res = await fetch('/api/v1/psychologists/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [initial.defaultModality, initial.defaultOutputLanguage, language, modality]);

  return (
    <Card className="p-6">
      <header className="mb-4">
        <h2 className="font-serif text-2xl">Preferences</h2>
        <p className="mt-1 text-sm text-[var(--color-ink-2)]">
          Defaults applied when you create a session or generate a note. Per-session and
          per-client overrides take precedence.
        </p>
      </header>

      <div className="space-y-4">
        <div>
          <label className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
            Default output language
          </label>
          <p className="mt-1 text-xs text-[var(--color-ink-3)]">
            The language Pass 2 / Pass 3 / Pass 5 narrative text is written in. Pass 1 always
            transcribes in the spoken language regardless.
          </p>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="mt-2 w-full rounded-xl border border-[var(--color-line-soft)] bg-white/40 p-3 text-sm"
          >
            <option value="en">English</option>
            <option value="ml">Malayalam (മലയാളം)</option>
            <option value="hi">Hindi (हिन्दी)</option>
            <option value="ta">Tamil (தமிழ்)</option>
            <option value="bn">Bengali (বাংলা)</option>
          </select>
        </div>

        <div>
          <label className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
            Default modality
          </label>
          <p className="mt-1 text-xs text-[var(--color-ink-3)]">
            Picked when creating a new session for a client without a preferredModality.
          </p>
          <select
            value={modality}
            onChange={(e) => setModality(e.target.value as SessionModality | '')}
            className="mt-2 w-full rounded-xl border border-[var(--color-line-soft)] bg-white/40 p-3 text-sm"
          >
            <option value="">— ask each time —</option>
            <option value="CBT">CBT</option>
            <option value="EMDR">EMDR</option>
            <option value="OTHER">Other</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-2xl border border-[var(--color-warn-border)] bg-[var(--color-warn-bg)] p-3 text-sm text-[var(--color-warn)]">
          {error}
        </div>
      )}
      {saved && (
        <div className="mt-4 rounded-2xl border border-[var(--color-accent)] bg-[var(--color-accent-soft)] p-3 text-sm text-[var(--color-ink)]">
          Preferences saved.
        </div>
      )}

      <div className="mt-6 flex justify-end border-t border-[var(--color-line-soft)] pt-4">
        <Button onClick={() => void submit()} disabled={busy}>
          {busy ? 'Saving…' : 'Save preferences'}
        </Button>
      </div>
    </Card>
  );
}
