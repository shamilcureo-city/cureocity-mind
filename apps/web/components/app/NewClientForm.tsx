'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { CheckboxRow, Input, Label, FieldError } from '../ui/Field';
import { readApiError, SCRIPT_VERSION } from './record-types';

interface Props {
  onCancel: () => void;
  /** Hands the created client to the shared confirm step. */
  onCreated: (client: { id: string; fullName: string }) => void;
}

/**
 * Sprint 23 — minimal intake-first onboarding for a brand-new client.
 *
 * The previous flow (PreFlightPanel's inline new-client form) inherited
 * the parent panel's modality + language pickers and pre-filled CBT from
 * the therapist's default — clinically wrong: intake is *how* you decide
 * the modality. This form deliberately asks for only what's required to
 * legally start recording: name + phone + two required consents. Cross-
 * border is offered as an optional pre-tick. Capture method is the
 * therapist's choice of room vs. screen-share.
 *
 * Email, language, presenting concerns, DOB, spoken-languages, etc. are
 * all editable from the client page after the intake — the intake
 * conversation surfaces most of these naturally and Pass 2 (IntakeNoteV1)
 * captures them into the note.
 *
 * On submit it creates ONLY the client (name + phone + consents) and hands
 * off to `RecordConfirmStrip` — the same confirm step every existing client
 * goes through. It used to also create the session, snapshot consent and
 * call /start, which dropped the therapist straight into the recorder the
 * instant they hit submit: no moment to check what they typed, and — because
 * the live-scribe choice lives in the confirm strip — no way for a NEW client
 * to ever use the live scribe. Intake is exactly where that matters most.
 *
 * Converging on the strip also removes three duplicated calls, the duplicated
 * 402 trial-cap handling, and the second consent snapshot. The strip's own
 * comment ("rare — new client flow handles the common case") shows this is
 * how it was meant to fit together: consents granted here at client creation
 * mean the strip asks for nothing further.
 */
export function NewClientForm({ onCancel, onCreated }: Props) {
  const [fullName, setFullName] = useState('');
  const [contactPhone, setContactPhone] = useState('+91');
  const [audioOk, setAudioOk] = useState(true);
  const [noteOk, setNoteOk] = useState(true);
  const [crossBorder, setCrossBorder] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The IndianPhoneSchema regex (`^\+91\d{10}$`) is strict on purpose
  // (WhatsApp + SMS routing need the canonical form), so accept spaces
  // / hyphens / parens in the input field and strip them on submit.
  const normalisedPhone = contactPhone.replace(/[\s\-()]/g, '');
  const ready = !!fullName.trim() && /^\+91\d{10}$/.test(normalisedPhone) && audioOk && noteOk;

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!ready) return;
    setError(null);
    setBusy(true);
    try {
      const ackedScopes: Array<
        'AUDIO_RECORDING' | 'AI_NOTE_GENERATION' | 'CROSS_BORDER_PROCESSING'
      > = [];
      if (audioOk) ackedScopes.push('AUDIO_RECORDING');
      if (noteOk) ackedScopes.push('AI_NOTE_GENERATION');
      if (crossBorder) ackedScopes.push('CROSS_BORDER_PROCESSING');

      // 1. Create the client with audio + AI note consents on file.
      const clientRes = await fetch('/api/v1/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: fullName.trim(),
          contactPhone: normalisedPhone,
          consents: [
            ...(audioOk
              ? [
                  {
                    scope: 'AUDIO_RECORDING',
                    scriptVersion: SCRIPT_VERSION,
                    capturedVia: 'IN_PERSON',
                  },
                ]
              : []),
            ...(noteOk
              ? [
                  {
                    scope: 'AI_NOTE_GENERATION',
                    scriptVersion: SCRIPT_VERSION,
                    capturedVia: 'IN_PERSON',
                  },
                ]
              : []),
            ...(crossBorder
              ? [
                  {
                    scope: 'CROSS_BORDER_PROCESSING',
                    scriptVersion: SCRIPT_VERSION,
                    capturedVia: 'IN_PERSON',
                  },
                ]
              : []),
          ],
        }),
      });
      if (!clientRes.ok) {
        throw new Error(await readApiError(clientRes, 'Create client failed'));
      }
      const created = (await clientRes.json()) as { id: string; fullName: string };

      // Hand off. Session create, per-session consent, capture choice and
      // /start all belong to the confirm step, which every other client
      // already uses — including the 402 trial-cap modal.
      onCreated(created);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-7">
      <button
        type="button"
        onClick={onCancel}
        className="mb-5 text-sm text-[var(--color-ink-3)] hover:text-[var(--color-ink)]"
      >
        ← Back
      </button>

      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-accent)]">
        New client
      </p>
      <h2 className="mt-1 font-serif text-2xl">First session with someone new</h2>
      <p className="mt-1 text-sm text-[var(--color-ink-2)]">
        Just the essentials. Everything else can wait.
      </p>

      <form onSubmit={submit} className="mt-6 space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="nc-name">Their name</Label>
            <Input
              id="nc-name"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              autoFocus
              autoComplete="off"
            />
          </div>
          <div>
            <Label htmlFor="nc-phone">Their phone</Label>
            <Input
              id="nc-phone"
              type="tel"
              required
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              placeholder="+91 98765 43210"
              autoComplete="off"
            />
            <p className="mt-1 text-xs text-[var(--color-ink-3)]">+91 + 10 digits.</p>
          </div>
        </div>

        <div>
          <Label>Consent (confirm they&apos;ve agreed before you start)</Label>
          <div className="mt-2 space-y-2">
            <CheckboxRow
              id="nc-audio"
              checked={audioOk}
              onChange={setAudioOk}
              label="Audio recording — they've agreed"
              description="We record this session so the AI can draft a note."
            />
            <CheckboxRow
              id="nc-note"
              checked={noteOk}
              onChange={setNoteOk}
              label="AI note generation — they've agreed"
              description="An AI processes the recording into a draft you'll review."
            />
            <CheckboxRow
              id="nc-cross-border"
              checked={crossBorder}
              onChange={setCrossBorder}
              label="Today's note can be processed outside India"
              description="Optional. We use a global model when our India region is constrained — tick only if they agreed."
            />
          </div>
        </div>

        <FieldError message={error} />

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-[var(--color-ink-3)]">
            Next you'll confirm how to capture this session. Email, language and presenting concerns can be added later from their client page.
          </p>
          <Button type="submit" disabled={!ready || busy}>
            {busy ? 'Adding…' : 'Add client & continue'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
