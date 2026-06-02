'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { CheckboxRow, Input, Label, Select, FieldError } from '../ui/Field';
import type { CaptureSource } from '@/lib/audio/use-session-recorder';

export interface PreRecordClient {
  id: string;
  fullName: string;
  preferredModality: string | null;
}

export interface PreRecordResult {
  sessionId: string;
  clientId: string;
  clientName: string;
  modality: 'CBT' | 'EMDR' | 'OTHER';
}

export type WizardStep = 'client' | 'modality' | 'consent';

interface Props {
  source: CaptureSource;
  initialClients: PreRecordClient[];
  onCancel: () => void;
  onReady: (result: PreRecordResult) => void;
}

const SCRIPT_VERSION = 'v1.0';

const MODE_LABEL: Record<CaptureSource, string> = {
  mic: 'In-person session',
  display: 'Virtual session (tab audio)',
  dictation: 'Dictate a summary',
};

const MODALITIES: { value: 'CBT' | 'EMDR' | 'OTHER'; label: string; body: string }[] = [
  { value: 'CBT', label: 'CBT', body: 'Cognitive behavioural — thought records, exposures, behavioural activation.' },
  { value: 'EMDR', label: 'EMDR', body: 'Trauma reprocessing with bilateral stimulation.' },
  { value: 'OTHER', label: 'Other', body: 'Psychodynamic, IFS, ACT, mindfulness, couples, supervision.' },
];

export function PreRecordWizard({ source, initialClients, onCancel, onReady }: Props) {
  const [step, setStep] = useState<WizardStep>('client');
  const [clients, setClients] = useState<PreRecordClient[]>(initialClients);
  const [chosenClientId, setChosenClientId] = useState<string>(initialClients[0]?.id ?? '');
  const [showNewClient, setShowNewClient] = useState(initialClients.length === 0);
  const [newClient, setNewClient] = useState({ fullName: '', contactPhone: '+91' });
  const [busyClient, setBusyClient] = useState(false);
  const [modality, setModality] = useState<'CBT' | 'EMDR' | 'OTHER'>('CBT');
  const [scopes, setScopes] = useState({
    AUDIO_RECORDING: true,
    AI_NOTE_GENERATION: true,
    CROSS_BORDER_PROCESSING: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // Pre-fill modality from the chosen client's preferred modality.
    const c = clients.find((x) => x.id === chosenClientId);
    if (c?.preferredModality && (c.preferredModality === 'CBT' || c.preferredModality === 'EMDR' || c.preferredModality === 'OTHER')) {
      setModality(c.preferredModality);
    }
  }, [chosenClientId, clients]);

  async function createClient(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setBusyClient(true);
    try {
      const res = await fetch('/api/v1/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: newClient.fullName.trim(),
          contactPhone: newClient.contactPhone.trim(),
          consents: [
            {
              scope: 'AUDIO_RECORDING',
              status: 'GRANTED',
              scriptVersion: SCRIPT_VERSION,
              capturedVia: 'IN_PERSON',
            },
            {
              scope: 'AI_NOTE_GENERATION',
              status: 'GRANTED',
              scriptVersion: SCRIPT_VERSION,
              capturedVia: 'IN_PERSON',
            },
          ],
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Create failed (${res.status})`);
      }
      const created = (await res.json()) as PreRecordClient;
      setClients((prev) => [{ id: created.id, fullName: created.fullName, preferredModality: null }, ...prev]);
      setChosenClientId(created.id);
      setShowNewClient(false);
      setStep('modality');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyClient(false);
    }
  }

  async function startSession(): Promise<void> {
    setError(null);
    setSubmitting(true);
    try {
      const create = await fetch('/api/v1/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: chosenClientId,
          modality,
          scheduledAt: new Date().toISOString(),
        }),
      });
      if (!create.ok) {
        const body = (await create.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Create session failed (${create.status})`);
      }
      const session = (await create.json()) as { id: string };

      const enabled = (Object.keys(scopes) as (keyof typeof scopes)[]).filter((k) => scopes[k]);
      const consent = await fetch(`/api/v1/sessions/${session.id}/consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scopes: enabled,
          scriptVersion: SCRIPT_VERSION,
        }),
      });
      if (!consent.ok) {
        const body = (await consent.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Record consent failed (${consent.status})`);
      }

      const start = await fetch(`/api/v1/sessions/${session.id}/start`, { method: 'POST' });
      if (!start.ok) {
        const body = (await start.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Start session failed (${start.status})`);
      }
      const clientName = clients.find((c) => c.id === chosenClientId)?.fullName ?? 'client';
      onReady({ sessionId: session.id, clientId: chosenClientId, clientName, modality });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-[rgba(15,27,42,0.45)] p-4">
      <Card className="w-full max-w-2xl p-7">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-accent)]">
              Before we record
            </p>
            <h2 className="mt-1 font-serif text-2xl">{MODE_LABEL[source]}</h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel"
            className="rounded-full p-2 text-[var(--color-ink-3)] hover:bg-[var(--color-surface-soft)]"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </header>

        <Stepper current={step} />

        {step === 'client' && (
          <section className="mt-6">
            {!showNewClient && clients.length > 0 ? (
              <div className="space-y-4">
                <div>
                  <Label htmlFor="client">Who is this session with?</Label>
                  <Select
                    id="client"
                    value={chosenClientId}
                    onChange={(e) => setChosenClientId(e.target.value)}
                  >
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.fullName}
                        {c.preferredModality ? ` — ${c.preferredModality}` : ''}
                      </option>
                    ))}
                  </Select>
                </div>
                <button
                  type="button"
                  onClick={() => setShowNewClient(true)}
                  className="text-sm text-[var(--color-accent)] underline"
                >
                  + Add a new client instead
                </button>
              </div>
            ) : (
              <form onSubmit={createClient} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="newName">Full name</Label>
                    <Input
                      id="newName"
                      required
                      value={newClient.fullName}
                      onChange={(e) => setNewClient((p) => ({ ...p, fullName: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label htmlFor="newPhone">Phone (international)</Label>
                    <Input
                      id="newPhone"
                      type="tel"
                      required
                      value={newClient.contactPhone}
                      onChange={(e) => setNewClient((p) => ({ ...p, contactPhone: e.target.value }))}
                    />
                  </div>
                </div>
                <FieldError message={error} />
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="submit" disabled={busyClient}>
                    {busyClient ? 'Creating…' : 'Create + continue'}
                  </Button>
                  {clients.length > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        setShowNewClient(false);
                        setError(null);
                      }}
                    >
                      Pick an existing client instead
                    </Button>
                  )}
                </div>
              </form>
            )}
            <FieldError message={error} />
            <Footer>
              {!showNewClient && (
                <Button onClick={() => setStep('modality')} disabled={!chosenClientId}>
                  Continue
                </Button>
              )}
            </Footer>
          </section>
        )}

        {step === 'modality' && (
          <section className="mt-6">
            <p className="text-sm text-[var(--color-ink-2)]">
              Which approach are you using today? This shapes the generated note.
            </p>
            <div className="mt-4 grid gap-2">
              {MODALITIES.map((m) => (
                <CheckboxRow
                  key={m.value}
                  id={`mod-${m.value}`}
                  checked={modality === m.value}
                  onChange={() => setModality(m.value)}
                  label={m.label}
                  description={m.body}
                />
              ))}
            </div>
            <Footer>
              <Button variant="secondary" onClick={() => setStep('client')}>
                Back
              </Button>
              <Button onClick={() => setStep('consent')}>Continue</Button>
            </Footer>
          </section>
        )}

        {step === 'consent' && (
          <section className="mt-6">
            <Badge tone="accent">Script v{SCRIPT_VERSION}</Badge>
            <p className="mt-3 text-sm leading-relaxed text-[var(--color-ink-2)]">
              Read the following with your client and confirm what they have agreed to. The
              consent snapshot is bound to this session and audited.
            </p>
            <div className="mt-5 space-y-2">
              <CheckboxRow
                id="scope-audio"
                checked={scopes.AUDIO_RECORDING}
                onChange={(v) => setScopes((p) => ({ ...p, AUDIO_RECORDING: v }))}
                label="Audio recording"
                description="We will record this session's audio so an AI scribe can draft a clinical note."
              />
              <CheckboxRow
                id="scope-ai"
                checked={scopes.AI_NOTE_GENERATION}
                onChange={(v) => setScopes((p) => ({ ...p, AI_NOTE_GENERATION: v }))}
                label="AI note generation"
                description="The recording is processed by an AI to create a SOAP-style draft that you will review and sign."
              />
              <CheckboxRow
                id="scope-cross-border"
                checked={scopes.CROSS_BORDER_PROCESSING}
                onChange={(v) => setScopes((p) => ({ ...p, CROSS_BORDER_PROCESSING: v }))}
                label="Cross-border processing"
                description="Note synthesis runs in a different country than where the audio was captured. Optional."
              />
            </div>
            <p className="mt-4 text-xs text-[var(--color-ink-3)]">
              Once recording starts, this session is in IN_PROGRESS and cannot accept further
              consent edits without ending it first.
            </p>
            <FieldError message={error} />
            <Footer>
              <Button variant="secondary" onClick={() => setStep('modality')}>
                Back
              </Button>
              <Button
                onClick={startSession}
                disabled={submitting || !scopes.AUDIO_RECORDING || !scopes.AI_NOTE_GENERATION}
              >
                {submitting ? 'Starting…' : 'Start recording'}
              </Button>
            </Footer>
          </section>
        )}
      </Card>
    </div>
  );
}

function Stepper({ current }: { current: WizardStep }) {
  const steps: { key: WizardStep; label: string }[] = [
    { key: 'client', label: 'Client' },
    { key: 'modality', label: 'Modality' },
    { key: 'consent', label: 'Consent' },
  ];
  const idx = steps.findIndex((s) => s.key === current);
  return (
    <ol className="flex items-center gap-2">
      {steps.map((s, i) => {
        const done = i < idx;
        const active = i === idx;
        return (
          <li key={s.key} className="flex flex-1 items-center gap-2">
            <span
              className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-medium ${
                done
                  ? 'bg-[var(--color-accent)] text-white'
                  : active
                    ? 'border border-[var(--color-accent)] text-[var(--color-accent)]'
                    : 'border border-[var(--color-line)] text-[var(--color-ink-3)]'
              }`}
            >
              {done ? '✓' : i + 1}
            </span>
            <span
              className={`text-xs uppercase tracking-wider ${
                active ? 'text-[var(--color-ink)]' : 'text-[var(--color-ink-3)]'
              }`}
            >
              {s.label}
            </span>
            {i < steps.length - 1 && (
              <span aria-hidden className="h-px flex-1 bg-[var(--color-line)]" />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Footer({ children }: { children: React.ReactNode }) {
  return <div className="mt-7 flex items-center justify-end gap-2">{children}</div>;
}

