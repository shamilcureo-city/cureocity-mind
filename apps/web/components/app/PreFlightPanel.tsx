'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type {
  ConsentScope,
  ModalitySource,
  SessionDefaults,
  SessionKind,
  SessionModality,
} from '@cureocity/contracts';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { CheckboxRow, Input, Label, Select, FieldError } from '../ui/Field';
import type { CaptureSource } from '@/lib/audio/use-session-recorder';

export interface PreFlightClient {
  id: string;
  fullName: string;
  preferredModality: string | null;
}

export interface PreFlightResult {
  sessionId: string;
  clientId: string;
  clientName: string;
  kind: SessionKind;
  modality: SessionModality | null;
}

interface Props {
  source: CaptureSource;
  initialClients: PreFlightClient[];
  onCancel: () => void;
  onReady: (result: PreFlightResult) => void;
}

const SCRIPT_VERSION = 'v1.0';

const MODE_LABEL: Record<CaptureSource, string> = {
  mic: 'In-person session',
  display: 'Virtual session (tab audio)',
  dictation: 'Dictate a summary',
};

const KIND_LABEL: Record<SessionKind, string> = {
  INTAKE: 'Intake',
  TREATMENT: 'Treatment',
  REVIEW: 'Plan review',
};

const KIND_BLURB: Record<SessionKind, string> = {
  INTAKE: 'First session — assess, formulate, defer modality if needed.',
  TREATMENT: 'Continuing per the active plan.',
  REVIEW: 'Time to re-evaluate the plan with the client.',
};

const MODALITY_OPTIONS: { value: SessionModality; label: string }[] = [
  { value: 'CBT', label: 'CBT' },
  { value: 'EMDR', label: 'EMDR' },
  { value: 'ACT', label: 'ACT — Acceptance & Commitment Therapy' },
  { value: 'IFS', label: 'IFS — Internal Family Systems' },
  { value: 'PSYCHODYNAMIC', label: 'Psychodynamic' },
  { value: 'MI', label: 'MI — Motivational Interviewing' },
  { value: 'MBCT', label: 'MBCT — Mindfulness-Based CBT' },
  { value: 'SUPPORTIVE', label: 'Supportive' },
  { value: 'INTAKE', label: 'Intake — defer modality choice' },
  { value: 'OTHER', label: 'Other' },
];

const LANGUAGE_OPTIONS: { value: string; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'Hindi' },
  { value: 'ml', label: 'Malayalam' },
  { value: 'ta', label: 'Tamil' },
  { value: 'bn', label: 'Bengali' },
];

const SOURCE_LABEL: Record<ModalitySource, string> = {
  plan: 'from active treatment plan',
  client: 'from this client’s preferred modality',
  therapist: 'from your clinic default',
  'intake-fallback': 'intake — defer until after assessment',
  'last-resort': 'fallback — no preference set yet',
};

const CONSENT_LABEL: Record<ConsentScope, string> = {
  AUDIO_RECORDING: 'Audio recording',
  AI_NOTE_GENERATION: 'AI note generation',
  CROSS_BORDER_PROCESSING: 'Cross-border processing',
  DATA_RETENTION_EXTENDED: 'Extended data retention',
};

const CONSENT_BLURB: Record<ConsentScope, string> = {
  AUDIO_RECORDING: "We record this session's audio so an AI scribe can draft a clinical note.",
  AI_NOTE_GENERATION:
    'The recording is processed by an AI to create a SOAP-style draft you will review and sign.',
  CROSS_BORDER_PROCESSING:
    'Note synthesis runs outside India. Optional — only tick if the client has agreed.',
  DATA_RETENTION_EXTENDED: 'Keep raw audio past the default 30-day retention. Optional.',
};

export function PreFlightPanel({ source, initialClients, onCancel, onReady }: Props) {
  const [clients, setClients] = useState<PreFlightClient[]>(initialClients);
  const [chosenClientId, setChosenClientId] = useState<string>(initialClients[0]?.id ?? '');
  const [showNewClient, setShowNewClient] = useState(initialClients.length === 0);
  const [newClient, setNewClient] = useState({ fullName: '', contactPhone: '+91' });
  const [busyClient, setBusyClient] = useState(false);

  const [defaults, setDefaults] = useState<SessionDefaults | null>(null);
  const [defaultsLoading, setDefaultsLoading] = useState(false);
  const [defaultsError, setDefaultsError] = useState<string | null>(null);

  const [modality, setModality] = useState<SessionModality | null>(null);
  const [language, setLanguage] = useState<string>('en');
  // Per-session consent ack — per-session is required by /consent even if
  // the client already granted globally. We pre-ack the already-granted
  // scopes silently and require the therapist to tick anything that's
  // brand new for this session (e.g. cross-border) before starting.
  const [crossBorderConsent, setCrossBorderConsent] = useState(false);
  const [extendedRetentionConsent, setExtendedRetentionConsent] = useState(false);
  const [missingRequiredConsents, setMissingRequiredConsents] = useState<Record<string, boolean>>(
    {},
  );

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Pull session-defaults whenever the selected client changes.
  useEffect(() => {
    if (!chosenClientId) {
      setDefaults(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      setDefaultsLoading(true);
      setDefaultsError(null);
      try {
        const res = await fetch(`/api/v1/clients/${chosenClientId}/session-defaults`, {
          cache: 'no-store',
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `Could not load session defaults (${res.status})`);
        }
        const payload = (await res.json()) as { defaults: SessionDefaults };
        if (cancelled) return;
        setDefaults(payload.defaults);
        setModality(payload.defaults.modality);
        setLanguage(payload.defaults.language);
        // Reset per-session consent state from the cascade.
        const newMissing: Record<string, boolean> = {};
        for (const scope of payload.defaults.consentsNeeded) {
          if (scope === 'AUDIO_RECORDING' || scope === 'AI_NOTE_GENERATION') {
            newMissing[scope] = false;
          }
        }
        setMissingRequiredConsents(newMissing);
        setCrossBorderConsent(
          payload.defaults.consentsAlreadyGranted.includes('CROSS_BORDER_PROCESSING'),
        );
        setExtendedRetentionConsent(false);
      } catch (e) {
        if (!cancelled) setDefaultsError((e as Error).message);
      } finally {
        if (!cancelled) setDefaultsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chosenClientId]);

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
      const created = (await res.json()) as PreFlightClient;
      setClients((prev) => [
        { id: created.id, fullName: created.fullName, preferredModality: null },
        ...prev,
      ]);
      setChosenClientId(created.id);
      setShowNewClient(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyClient(false);
    }
  }

  async function startSession(): Promise<void> {
    if (!defaults) return;
    setError(null);
    setSubmitting(true);
    try {
      // POST /sessions: modality is OPTIONAL. We send the panel value;
      // the server-side cascade re-runs and audits whether what we
      // sent matches the inferred default (SESSION_MODALITY_INFERRED
      // vs SESSION_MODALITY_OVERRIDDEN).
      const create = await fetch('/api/v1/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: chosenClientId,
          modality: modality ?? undefined,
          scheduledAt: new Date().toISOString(),
        }),
      });
      if (!create.ok) {
        const body = (await create.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Create session failed (${create.status})`);
      }
      const sessionRow = (await create.json()) as {
        id: string;
        kind: SessionKind;
        modality: SessionModality | null;
      };

      // Per-session consent snapshot: re-ack everything granted at
      // signup plus anything the therapist ticked in this panel.
      const ackedScopes = new Set<ConsentScope>(defaults.consentsAlreadyGranted);
      for (const [scope, ticked] of Object.entries(missingRequiredConsents)) {
        if (ticked) ackedScopes.add(scope as ConsentScope);
      }
      if (crossBorderConsent) ackedScopes.add('CROSS_BORDER_PROCESSING');
      else ackedScopes.delete('CROSS_BORDER_PROCESSING');
      if (extendedRetentionConsent) ackedScopes.add('DATA_RETENTION_EXTENDED');

      const consent = await fetch(`/api/v1/sessions/${sessionRow.id}/consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scopes: Array.from(ackedScopes),
          scriptVersion: SCRIPT_VERSION,
        }),
      });
      if (!consent.ok) {
        const body = (await consent.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Record consent failed (${consent.status})`);
      }

      const start = await fetch(`/api/v1/sessions/${sessionRow.id}/start`, {
        method: 'POST',
      });
      if (!start.ok) {
        const body = (await start.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Start session failed (${start.status})`);
      }
      const clientName = clients.find((c) => c.id === chosenClientId)?.fullName ?? 'client';
      onReady({
        sessionId: sessionRow.id,
        clientId: chosenClientId,
        clientName,
        kind: sessionRow.kind,
        modality: sessionRow.modality,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  // The Start button needs every required-but-not-yet-granted consent
  // ticked. Cross-border + extended-retention are always optional.
  const allRequiredAcked = Object.values(missingRequiredConsents).every(Boolean);
  const ready =
    !!defaults &&
    !defaultsLoading &&
    !defaultsError &&
    !!chosenClientId &&
    !showNewClient &&
    allRequiredAcked;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-[rgba(15,27,42,0.45)] p-4">
      <Card className="max-h-[92vh] w-full max-w-2xl overflow-y-auto p-7">
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
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </header>

        <section className="space-y-7">
          {/* Client picker */}
          <div>
            <Label htmlFor="pf-client">Client</Label>
            {!showNewClient && clients.length > 0 ? (
              <div className="space-y-2">
                <Select
                  id="pf-client"
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
                <button
                  type="button"
                  onClick={() => setShowNewClient(true)}
                  className="text-sm text-[var(--color-accent)] underline"
                >
                  + Add a new client instead
                </button>
              </div>
            ) : (
              <form onSubmit={createClient} className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="pf-new-name">Full name</Label>
                    <Input
                      id="pf-new-name"
                      required
                      value={newClient.fullName}
                      onChange={(e) => setNewClient((p) => ({ ...p, fullName: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label htmlFor="pf-new-phone">Phone (international)</Label>
                    <Input
                      id="pf-new-phone"
                      type="tel"
                      required
                      value={newClient.contactPhone}
                      onChange={(e) =>
                        setNewClient((p) => ({ ...p, contactPhone: e.target.value }))
                      }
                    />
                  </div>
                </div>
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
          </div>

          {/* Cascade summary — only shown once defaults arrive */}
          {defaultsLoading && (
            <div className="rounded-2xl border border-dashed border-[var(--color-line)] bg-[var(--color-surface-soft)] px-4 py-3 text-sm text-[var(--color-ink-3)]">
              Loading defaults for this client…
            </div>
          )}
          {defaultsError && <FieldError message={defaultsError} />}

          {defaults && !defaultsLoading && (
            <>
              <CascadeSummary defaults={defaults} />

              <div>
                <Label htmlFor="pf-modality">Modality</Label>
                <Select
                  id="pf-modality"
                  value={modality ?? ''}
                  onChange={(e) => setModality((e.target.value || null) as SessionModality | null)}
                >
                  {MODALITY_OPTIONS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </Select>
                <p className="mt-1.5 text-xs text-[var(--color-ink-3)]">
                  Default: {defaults.modality ?? 'none'} — {SOURCE_LABEL[defaults.modalitySource]}.
                  Change only if today’s session calls for a different approach.
                </p>
              </div>

              <div>
                <Label htmlFor="pf-language">Note language</Label>
                <Select
                  id="pf-language"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                >
                  {LANGUAGE_OPTIONS.map((l) => (
                    <option key={l.value} value={l.value}>
                      {l.label}
                    </option>
                  ))}
                </Select>
                {defaults.spokenLanguages.length > 0 && (
                  <p className="mt-1.5 text-xs text-[var(--color-ink-3)]">
                    Client speaks: {defaults.spokenLanguages.join(', ')} — transcription biases to
                    these.
                  </p>
                )}
              </div>

              {/* Per-session consent ack */}
              <div>
                <div className="mb-2 flex items-baseline justify-between">
                  <Label htmlFor="pf-consent">Consent</Label>
                  <Badge tone="accent">Script {SCRIPT_VERSION}</Badge>
                </div>
                <p className="text-sm text-[var(--color-ink-2)]">
                  Confirm what the client has agreed to today. We re-ack the scopes they granted at
                  signup automatically; only new consents need a tick.
                </p>

                <div className="mt-3 space-y-2">
                  {defaults.consentsAlreadyGranted
                    .filter((s) => s === 'AUDIO_RECORDING' || s === 'AI_NOTE_GENERATION')
                    .map((scope) => (
                      <GrantedConsentRow
                        key={scope}
                        label={CONSENT_LABEL[scope]}
                        blurb={CONSENT_BLURB[scope]}
                      />
                    ))}

                  {Object.keys(missingRequiredConsents).map((scope) => (
                    <CheckboxRow
                      key={scope}
                      id={`pf-${scope}`}
                      checked={missingRequiredConsents[scope] ?? false}
                      onChange={(v) => setMissingRequiredConsents((p) => ({ ...p, [scope]: v }))}
                      label={`${CONSENT_LABEL[scope as ConsentScope]} — required`}
                      description={CONSENT_BLURB[scope as ConsentScope]}
                    />
                  ))}

                  <CheckboxRow
                    id="pf-cross-border"
                    checked={crossBorderConsent}
                    onChange={setCrossBorderConsent}
                    label={`${CONSENT_LABEL.CROSS_BORDER_PROCESSING} — optional`}
                    description={CONSENT_BLURB.CROSS_BORDER_PROCESSING}
                  />

                  <CheckboxRow
                    id="pf-extended-retention"
                    checked={extendedRetentionConsent}
                    onChange={setExtendedRetentionConsent}
                    label={`${CONSENT_LABEL.DATA_RETENTION_EXTENDED} — optional`}
                    description={CONSENT_BLURB.DATA_RETENTION_EXTENDED}
                  />
                </div>
                <p className="mt-3 text-xs text-[var(--color-ink-3)]">
                  Once recording starts, this session is in IN_PROGRESS and cannot accept further
                  consent edits without ending it first.
                </p>
              </div>
            </>
          )}

          <FieldError message={error} />

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
            <Button onClick={startSession} disabled={!ready || submitting}>
              {submitting ? 'Starting…' : 'Start recording'}
            </Button>
          </div>
        </section>
      </Card>
    </div>
  );
}

function CascadeSummary({ defaults }: { defaults: SessionDefaults }) {
  const phq9 = defaults.lastInstrumentAdministrations.PHQ9 ?? null;
  const gad7 = defaults.lastInstrumentAdministrations.GAD7 ?? null;
  return (
    <div className="rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="accent">{KIND_LABEL[defaults.kind]}</Badge>
        <span className="text-sm text-[var(--color-ink-2)]">{KIND_BLURB[defaults.kind]}</span>
      </div>
      <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-xs text-[var(--color-ink-3)] sm:grid-cols-2">
        <div>
          <dt className="inline font-medium text-[var(--color-ink-2)]">Sessions so far:</dt>{' '}
          <dd className="inline">{defaults.sessionsCompleted}</dd>
        </div>
        <div>
          <dt className="inline font-medium text-[var(--color-ink-2)]">PHQ-9 last:</dt>{' '}
          <dd className="inline">{phq9 ? formatRelative(phq9) : 'never'}</dd>
        </div>
        <div>
          <dt className="inline font-medium text-[var(--color-ink-2)]">GAD-7 last:</dt>{' '}
          <dd className="inline">{gad7 ? formatRelative(gad7) : 'never'}</dd>
        </div>
      </dl>
    </div>
  );
}

function GrantedConsentRow({ label, blurb }: { label: string; blurb: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] px-4 py-3">
      <span
        aria-hidden
        className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[var(--color-accent)] text-white"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 12l5 5 9-9" />
        </svg>
      </span>
      <span className="flex-1">
        <span className="block text-sm font-medium text-[var(--color-ink)]">
          {label}{' '}
          <span className="text-xs font-normal text-[var(--color-ink-3)]">· granted at signup</span>
        </span>
        <span className="mt-0.5 block text-xs text-[var(--color-ink-3)]">{blurb}</span>
      </span>
    </div>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'unknown';
  const diff = Date.now() - then;
  const day = 24 * 60 * 60 * 1000;
  if (diff < day) return 'today';
  if (diff < 2 * day) return 'yesterday';
  const days = Math.round(diff / day);
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  return months === 1 ? '1 month ago' : `${months} months ago`;
}
