'use client';

import { useState, type FormEvent } from 'react';
import type { SessionKind, SessionModality } from '@cureocity/contracts';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { CheckboxRow, Input, Label, FieldError } from '../ui/Field';
import { type RecordReady, SCRIPT_VERSION } from './record-types';
import { isDisplayCaptureSupported, type CaptureSource } from '@/lib/audio/use-session-recorder';

interface Props {
  onCancel: () => void;
  onReady: (result: RecordReady) => void;
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
 * On submit (one chained call):
 *   1. POST /clients     — name + phone + audio/ai-note consents
 *   2. POST /sessions    — kind: INTAKE (server-inferred), modality: null
 *   3. POST /sessions/:id/consent — re-ack the scopes for this session
 *   4. POST /sessions/:id/start
 */
export function NewClientForm({ onCancel, onReady }: Props) {
  const [fullName, setFullName] = useState('');
  const [contactPhone, setContactPhone] = useState('+91');
  const [audioOk, setAudioOk] = useState(true);
  const [noteOk, setNoteOk] = useState(true);
  const [crossBorder, setCrossBorder] = useState(false);
  const [method, setMethod] = useState<CaptureSource>('mic');
  const [displaySupported] = useState(() => isDisplayCaptureSupported());

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ready = !!fullName.trim() && contactPhone.trim().startsWith('+91') && audioOk && noteOk;

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!ready) return;
    setError(null);
    setBusy(true);
    try {
      const ackedScopes: Array<'AUDIO_RECORDING' | 'AI_NOTE_GENERATION' | 'CROSS_BORDER_PROCESSING'> =
        [];
      if (audioOk) ackedScopes.push('AUDIO_RECORDING');
      if (noteOk) ackedScopes.push('AI_NOTE_GENERATION');
      if (crossBorder) ackedScopes.push('CROSS_BORDER_PROCESSING');

      // 1. Create the client with audio + AI note consents on file.
      const clientRes = await fetch('/api/v1/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: fullName.trim(),
          contactPhone: contactPhone.trim(),
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
        const body = (await clientRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Create client failed (${clientRes.status})`);
      }
      const created = (await clientRes.json()) as { id: string; fullName: string };

      // 2. Create the session. modality omitted so the cascade picks
      // INTAKE (no plan, no prior session, no preferred modality →
      // INTAKE fallback). kind is server-inferred as INTAKE.
      const sessionRes = await fetch('/api/v1/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: created.id,
          scheduledAt: new Date().toISOString(),
        }),
      });
      if (!sessionRes.ok) {
        const body = (await sessionRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Create session failed (${sessionRes.status})`);
      }
      const sessionRow = (await sessionRes.json()) as {
        id: string;
        kind: SessionKind;
        modality: SessionModality | null;
      };

      // 3. Per-session consent snapshot.
      const consentRes = await fetch(`/api/v1/sessions/${sessionRow.id}/consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scopes: ackedScopes,
          scriptVersion: SCRIPT_VERSION,
        }),
      });
      if (!consentRes.ok) {
        const body = (await consentRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Record consent failed (${consentRes.status})`);
      }

      // 4. Move session to IN_PROGRESS.
      const startRes = await fetch(`/api/v1/sessions/${sessionRow.id}/start`, { method: 'POST' });
      if (!startRes.ok) {
        const body = (await startRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Start session failed (${startRes.status})`);
      }

      onReady({
        sessionId: sessionRow.id,
        clientId: created.id,
        clientName: created.fullName,
        kind: sessionRow.kind,
        modality: sessionRow.modality,
        source: method,
      });
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
              autoComplete="off"
            />
          </div>
        </div>

        <div>
          <Label>Consent (confirm they&apos;ve agreed before you start)</Label>
          <div className="mt-2 space-y-2">
            <CheckboxRow
              id="nc-audio"
              checked={audioOk}
              onChange={setAudioOk}
              label="Audio recording — they&apos;ve agreed"
              description="We record this session so the AI can draft a note."
            />
            <CheckboxRow
              id="nc-note"
              checked={noteOk}
              onChange={setNoteOk}
              label="AI note generation — they&apos;ve agreed"
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

        <div>
          <Label>Recording method</Label>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <MethodOption
              checked={method === 'mic'}
              onSelect={() => setMethod('mic')}
              title="In person"
              description="This device's microphone."
            />
            <MethodOption
              checked={method === 'display'}
              onSelect={() => setMethod('display')}
              title="Virtual"
              description="Capture tab audio for an online session."
              disabled={!displaySupported}
            />
          </div>
        </div>

        <FieldError message={error} />

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-[var(--color-ink-3)]">
            Add email, language, presenting concerns later from their client page.
          </p>
          <Button type="submit" disabled={!ready || busy}>
            {busy ? 'Starting…' : 'Start intake'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function MethodOption({
  checked,
  onSelect,
  title,
  description,
  disabled,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  description: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onSelect}
      disabled={disabled}
      className={`relative rounded-2xl border px-4 py-3 text-left transition-colors ${
        disabled
          ? 'cursor-not-allowed border-[var(--color-line)] opacity-60'
          : checked
            ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
            : 'border-[var(--color-line)] hover:border-[var(--color-ink)]'
      }`}
    >
      <span className="flex items-center gap-2 text-sm font-medium text-[var(--color-ink)]">
        <span
          aria-hidden
          className={`grid h-4 w-4 place-items-center rounded-full border ${
            checked
              ? 'border-[var(--color-accent)] bg-[var(--color-accent)]'
              : 'border-[var(--color-line)]'
          }`}
        >
          {checked && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
        </span>
        {title}
      </span>
      <p className="mt-1 text-xs text-[var(--color-ink-3)]">{description}</p>
      {disabled && (
        <span className="absolute right-3 top-3 rounded-full bg-[var(--color-warn-soft)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--color-warn)]">
          Browser n/a
        </span>
      )}
    </button>
  );
}
