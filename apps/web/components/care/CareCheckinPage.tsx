'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { MoodDial } from './MoodDial';

/**
 * CG4 — the ≤30-second daily ritual: dial (≤10s) + one optional line
 * against the last report's reflectionPrompt. The line feeds the case
 * file, so every check-in makes the next session visibly better — the
 * investment step of the loop, and the ethical variable reward.
 */
export function CareCheckinPage({
  personaName,
  reflectionPrompt,
}: {
  personaName: string;
  reflectionPrompt: string | null;
}) {
  const router = useRouter();
  const [mood, setMood] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    if (mood === null || busy) return;
    setBusy(true);
    try {
      await fetch('/api/v1/care/checkins', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mood, ...(note.trim() ? { note: note.trim() } : {}) }),
      });
      setDone(true);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="mx-auto w-full max-w-md px-5 py-6 pb-28 md:max-w-2xl md:px-8 md:py-10">
        <Card className="p-5 text-center">
          <p className="text-sm">
            Noted. {personaName} will remember{note.trim() ? ' — your words, next session' : ''}. 🌱
          </p>
          <Button className="mt-4" variant="secondary" onClick={() => router.push('/care/home')}>
            Back home →
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md px-5 py-6 pb-28 md:max-w-2xl md:px-8 md:py-10">
      <h1 className="font-serif text-2xl font-semibold">How was today, really?</h1>
      <Card className="mt-4 p-4">
        <MoodDial value={mood} onChange={setMood} label="Ten seconds — one honest number" />
        <label className="mt-4 block text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
          {reflectionPrompt
            ? `One line, just for you and ${personaName}`
            : 'Anything worth remembering? (optional)'}
          {reflectionPrompt ? (
            <span className="mt-1 block text-[13px] font-normal normal-case tracking-normal text-[var(--color-ink-2)]">
              Last time you wanted to sit with: &ldquo;{reflectionPrompt}&rdquo;
            </span>
          ) : null}
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={280}
            className="mt-2 w-full rounded-xl border border-[var(--color-line)] px-3 py-2 text-sm font-normal normal-case tracking-normal"
          />
        </label>
        <Button
          className="mt-3 w-full"
          disabled={mood === null || busy}
          onClick={() => void submit()}
        >
          {busy ? 'Saving…' : 'Done ✓'}
        </Button>
      </Card>
    </div>
  );
}
