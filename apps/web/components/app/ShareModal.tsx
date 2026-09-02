'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  PatientShareChannel,
  PatientShareSnapshot,
  ShareArtefactRef,
  ShareResponse,
  ShareResultEntry,
  SharePreviewResponse,
} from '@cureocity/contracts';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { useModalA11y } from '@/lib/use-modal-a11y';
import {
  choosePersistedDeliveryChannel,
  hydrateMindOutcomeSelection,
  shouldSavePatientTakeaway,
  successfulPreference,
  type MindOutcomeCandidate,
} from '@/lib/mind-care-loop';
import {
  createMindShareRequestLifecycle,
  type MindShareLoadState,
  type MindShareRequestIdentity,
} from '@/lib/mind-share-request-lifecycle';

interface ShareModalProps {
  open: boolean;
  onClose: () => void;
  clientId: string;
  /** Contact availability hints to grey out invalid channels. */
  hasContactPhone: boolean;
  hasContactEmail: boolean;
  /** What's being shared — discriminator + ids. */
  artefact: ShareArtefactRef;
  /** Short label shown in the modal header. */
  artefactLabel: string;
  /**
   * The client's preferred language (raw ISO). When provided, the modal
   * shows a language selector (defaulting to it) so the therapist can see /
   * choose the language the client receives — a signed note is translated
   * into it without touching the record. Omitted → no selector, and the
   * server keeps defaulting to the client's preferred language as before.
   */
  defaultLanguage?: string;
  /** Mind-only outcome-first mode; legacy/Doctor callers omit this. */
  outcomeCandidates?: MindOutcomeCandidate[];
  onDoNotSend?: () => void | Promise<void>;
  mindSessionId?: string;
}

// The languages a share can be delivered in (ClinicalLocale). Kept as plain
// data so this client component doesn't pull in the Zod enum.
const SHARE_LANGUAGES: { code: string; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'ml', label: 'Malayalam' },
  { code: 'hi', label: 'Hindi' },
  { code: 'ta', label: 'Tamil' },
  { code: 'bn', label: 'Bengali' },
];

function coerceShareLanguage(v: string | undefined): string {
  return SHARE_LANGUAGES.some((l) => l.code === v) ? (v as string) : 'en';
}

function shareLanguageLabel(code: string): string {
  return SHARE_LANGUAGES.find((l) => l.code === code)?.label ?? 'English';
}

const ALL_CHANNELS: { key: PatientShareChannel; label: string; description: string }[] = [
  {
    key: 'WHATSAPP',
    label: 'WhatsApp',
    description: "Short message + link, sent to the client's number on file.",
  },
  {
    key: 'EMAIL',
    label: 'Email',
    description: "Plain-text + link, sent to the client's email on file.",
  },
  {
    key: 'PORTAL_LINK',
    label: 'Portal link only',
    description: 'No send — copy the URL and share manually.',
  },
];

const TAKEAWAY_EDIT_COPY =
  'Edits replace the saved patient-facing takeaway and are recorded as an audited update.';

/**
 * Plain-language destination line for the pre-send preview. The modal
 * only knows *whether* a phone/email is on file (not the literal
 * value), so we describe the destination rather than print it.
 */
function previewDestination(channel: PatientShareChannel): string {
  switch (channel) {
    case 'WHATSAPP':
      return 'WhatsApp — to the phone number on file';
    case 'EMAIL':
      return 'Email — to the email address on file';
    case 'PORTAL_LINK':
      return 'Portal link only — nothing is sent; copy the link to share yourself';
  }
}

export function ShareModal({
  open,
  onClose,
  clientId,
  hasContactPhone,
  hasContactEmail,
  artefact,
  artefactLabel,
  defaultLanguage,
  outcomeCandidates,
  onDoNotSend,
  mindSessionId,
}: ShareModalProps) {
  const showLanguage = defaultLanguage !== undefined;
  const [selected, setSelected] = useState<Record<PatientShareChannel, boolean>>({
    WHATSAPP: hasContactPhone,
    EMAIL: hasContactEmail,
    PORTAL_LINK: !hasContactPhone && !hasContactEmail,
  });
  const [language, setLanguage] = useState<string>(() => coerceShareLanguage(defaultLanguage));
  const [therapistMessage, setTherapistMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ShareResultEntry[] | null>(null);
  const [outcomeIndex, setOutcomeIndex] = useState(0);
  const [takeaway, setTakeaway] = useState('');
  const [persistedTakeaway, setPersistedTakeaway] = useState('');
  const [resolvedCandidates, setResolvedCandidates] = useState<MindOutcomeCandidate[] | null>(null);
  const [mindLoadState, setMindLoadState] = useState<MindShareLoadState>({
    status: 'closed',
    requestIdentity: null,
  });
  const skipSend =
    onDoNotSend ??
    (mindSessionId
      ? async () => {
          const response = await fetch(`/api/v1/sessions/${mindSessionId}/mind-closeout`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ step: 'shared', outcome: 'SKIPPED' }),
          });
          if (!response.ok) throw new Error('Could not record the sharing decision.');
        }
      : undefined);
  // SHARE-3 — the translated, patient-facing snapshot the therapist reviews
  // before the real send (only for notes shared in a non-English language).
  const [preview, setPreview] = useState<SharePreviewResponse | null>(null);
  // Sprint 43 — which send channels this deployment can actually deliver
  // on. Null until loaded; greying falls back to contact-availability.
  const [config, setConfig] = useState<{
    whatsappConfigured: boolean;
    emailConfigured: boolean;
  } | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const deliveryIdempotencyKeyRef = useRef<string | null>(null);
  const renderLifecycleRef = useRef({ key: '', generation: 0 });
  const renderLifecycleKey = `${open}:${clientId}:${mindSessionId ?? ''}`;
  if (renderLifecycleRef.current.key !== renderLifecycleKey) {
    renderLifecycleRef.current = {
      key: renderLifecycleKey,
      generation: renderLifecycleRef.current.generation + 1,
    };
    deliveryIdempotencyKeyRef.current = null;
  }
  const currentMindRequestIdentity = useMemo<MindShareRequestIdentity | null>(
    () => (open && mindSessionId ? { mindSessionId, clientId } : null),
    [open, mindSessionId, clientId],
  );
  const [mindShareLifecycle] = useState(() =>
    createMindShareRequestLifecycle({
      clearPhi: () => {
        setResolvedCandidates(null);
        setTakeaway('');
        setPersistedTakeaway('');
        setOutcomeIndex(0);
        setPreview(null);
        setResults(null);
        setTherapistMessage('');
        setError(null);
        setBusy(false);
        setSelected({
          WHATSAPP: hasContactPhone,
          EMAIL: hasContactEmail,
          PORTAL_LINK: !hasContactPhone && !hasContactEmail,
        });
      },
      resetDeliveryIdentity: () => {
        deliveryIdempotencyKeyRef.current = null;
      },
      applyState: (state) => {
        setMindLoadState(state);
        if (state.status !== 'ready') return;
        const hydrated = hydrateMindOutcomeSelection(state.candidates);
        setResolvedCandidates(hydrated.candidates);
        setOutcomeIndex(hydrated.outcomeIndex);
        setTakeaway(hydrated.takeaway);
        setPersistedTakeaway(hydrated.persistedTakeaway);
      },
    }),
  );
  const mindCandidatesReady =
    !mindSessionId ||
    (currentMindRequestIdentity !== null &&
      mindLoadState.status === 'ready' &&
      mindLoadState.requestIdentity.mindSessionId === currentMindRequestIdentity.mindSessionId &&
      mindLoadState.requestIdentity.clientId === currentMindRequestIdentity.clientId);
  const visibleTakeaway = mindCandidatesReady ? takeaway : '';
  const visiblePreview = mindCandidatesReady ? preview : null;
  const visibleResults = mindCandidatesReady ? results : null;
  const visibleTherapistMessage = mindCandidatesReady ? therapistMessage : '';
  const effectiveCandidates: MindOutcomeCandidate[] | undefined = mindSessionId
    ? mindCandidatesReady
      ? (resolvedCandidates ?? undefined)
      : undefined
    : outcomeCandidates;
  const activeArtefact = effectiveCandidates?.[outcomeIndex]?.artefact ?? artefact;
  const activeArtefactKey = JSON.stringify(activeArtefact);
  const activeArtefactLabel = effectiveCandidates?.[outcomeIndex]?.label ?? artefactLabel;
  useModalA11y(open, dialogRef, onClose);

  useEffect(() => {
    if (!currentMindRequestIdentity) {
      mindShareLifecycle.transition(null, null);
      return;
    }
    mindShareLifecycle.transition(currentMindRequestIdentity, async (signal) => {
      if (outcomeCandidates) return outcomeCandidates;
      const response = await fetch(
        `/api/v1/sessions/${currentMindRequestIdentity.mindSessionId}/mind-share-options`,
        {
          cache: 'no-store',
          signal,
        },
      );
      if (!response.ok) throw new Error('Could not load sharing options.');
      const body = (await response.json()) as { candidates?: unknown };
      if (!Array.isArray(body.candidates)) return body.candidates;
      const hasTakeaway = body.candidates.some(
        (candidate) =>
          Boolean(candidate) &&
          typeof candidate === 'object' &&
          (candidate as MindOutcomeCandidate).artefact?.artefactType === 'SESSION_TAKEAWAY',
      );
      return hasTakeaway
        ? body.candidates
        : [
            {
              label: 'Session takeaway',
              artefact: {
                artefactType: 'SESSION_TAKEAWAY',
                sessionId: currentMindRequestIdentity.mindSessionId,
              },
            },
            ...body.candidates,
          ];
    });
    return () => {
      mindShareLifecycle.dispose();
    };
  }, [currentMindRequestIdentity, mindShareLifecycle, outcomeCandidates]);

  // Reset state when modal closes.
  useEffect(() => {
    if (!open) {
      setError(null);
      setResults(null);
      setBusy(false);
      setPreview(null);
    }
  }, [open]);

  // A preview is bound to the exact artefact, language, recipients/channels,
  // and therapist message. Never let a confirmation survive any payload drift.
  useEffect(() => {
    setPreview(null);
  }, [language, therapistMessage, activeArtefactKey, selected]);

  // Seed the language from the client's preference each time the modal opens.
  // TS7.1 — but the therapist's LAST choice for THIS client wins over the
  // profile default: pick a channel + language once, and the sheet opens
  // pre-set forever after (per-device memory, no schema).
  useEffect(() => {
    if (!open) return;
    setLanguage(coerceShareLanguage(defaultLanguage));
    try {
      const raw = window.localStorage.getItem(`cm.sharePrefs.${clientId}`);
      if (!raw) return;
      const prefs = JSON.parse(raw) as { language?: string };
      if (typeof prefs.language === 'string' && prefs.language) {
        setLanguage(coerceShareLanguage(prefs.language));
      }
    } catch {
      // localStorage unavailable / corrupt prefs — profile defaults stand.
    }
  }, [open, defaultLanguage, clientId, hasContactPhone, hasContactEmail]);

  // Load channel config when the modal opens; drop selections for
  // channels the server can't deliver on so the therapist never sends
  // into a silent no-op.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/v1/share/config', { cache: 'no-store' });
        if (!res.ok) return;
        const cfg = (await res.json()) as {
          whatsappConfigured: boolean;
          emailConfigured: boolean;
        };
        if (cancelled) return;
        setConfig(cfg);
        // Durable server truth leads; localStorage above is only a fallback.
        const historyRes = await fetch(`/api/v1/clients/${clientId}/shares?limit=50`, {
          cache: 'no-store',
        });
        if (historyRes.ok) {
          const history = (await historyRes.json()) as {
            lastSuccessfulChannel: PatientShareChannel | null;
            items: Array<{
              channel: PatientShareChannel;
              status: import('@cureocity/contracts').PatientShareStatus;
              sentAt: string | null;
              createdAt: string;
            }>;
          };
          const available = {
            WHATSAPP: cfg.whatsappConfigured && hasContactPhone,
            EMAIL: cfg.emailConfigured && hasContactEmail,
            PORTAL_LINK: true,
          };
          const preferred =
            history.lastSuccessfulChannel && available[history.lastSuccessfulChannel]
              ? history.lastSuccessfulChannel
              : choosePersistedDeliveryChannel(history.items, available);
          if (preferred) {
            setSelected({
              WHATSAPP: preferred === 'WHATSAPP',
              EMAIL: preferred === 'EMAIL',
              PORTAL_LINK: preferred === 'PORTAL_LINK',
            });
            return;
          }
        }
        setSelected((s) => {
          const next = {
            ...s,
            WHATSAPP: s.WHATSAPP && cfg.whatsappConfigured && hasContactPhone,
            EMAIL: s.EMAIL && cfg.emailConfigured && hasContactEmail,
          };
          if (!next.WHATSAPP && !next.EMAIL) next.PORTAL_LINK = true;
          return next;
        });
      } catch {
        /* leave config null — fall back to contact-only greying */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, hasContactPhone, hasContactEmail, clientId]);

  const toggle = useCallback((key: PatientShareChannel) => {
    setSelected((s) => ({ ...s, [key]: !s[key] }));
  }, []);

  const selectedChannels = useMemo(
    () => ALL_CHANNELS.filter((c) => selected[c.key]).map((c) => c.key),
    [selected],
  );

  // Every signed-note share is gated by review, including English. The server
  // binds that review to the exact locked signature version; translated notes
  // additionally preserve the reviewed translated snapshot byte-for-byte.
  const translatableNote =
    activeArtefact.artefactType === 'SIGNED_NOTE' ||
    activeArtefact.artefactType === 'SIGNED_INTAKE_NOTE';
  const needsPreviewGate = translatableNote;

  const submit = useCallback(async () => {
    if (
      mindSessionId &&
      (!currentMindRequestIdentity || !mindShareLifecycle.canSubmit(currentMindRequestIdentity))
    ) {
      setError('Sharing options are not ready.');
      return;
    }
    if (selectedChannels.length === 0) {
      setError('Pick at least one channel.');
      return;
    }
    if (activeArtefact.artefactType === 'SESSION_TAKEAWAY' && !takeaway.trim()) {
      setError('Write the patient-facing session takeaway first.');
      return;
    }
    const submissionGeneration = renderLifecycleRef.current.generation;
    setBusy(true);
    setError(null);
    try {
      if (
        activeArtefact.artefactType === 'SESSION_TAKEAWAY' &&
        shouldSavePatientTakeaway(takeaway, persistedTakeaway)
      ) {
        const saved = await fetch(`/api/v1/sessions/${activeArtefact.sessionId}/patient-takeaway`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ summary: takeaway.trim() }),
        });
        if (!saved.ok) throw new Error('Could not save the session takeaway.');
        if (submissionGeneration !== renderLifecycleRef.current.generation) return;
        setPersistedTakeaway(takeaway.trim());
      }
      // First click on a non-English note fetches the preview instead of
      // sending; the therapist reviews it, then a second click confirms.
      const wantPreview = needsPreviewGate && preview === null;
      if (!wantPreview && deliveryIdempotencyKeyRef.current === null) {
        deliveryIdempotencyKeyRef.current = crypto.randomUUID();
      }
      const res = await fetch('/api/v1/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          channels: selectedChannels,
          ...(therapistMessage.trim().length > 0 && { therapistMessage: therapistMessage.trim() }),
          ...(showLanguage && { language }),
          artefact: activeArtefact,
          ...(wantPreview && { preview: true }),
          ...(!wantPreview &&
            preview?.previewConfirmation && {
              previewConfirmation: preview.previewConfirmation,
            }),
          ...(!wantPreview && { idempotencyKey: deliveryIdempotencyKeyRef.current }),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as ShareResponse &
        SharePreviewResponse & { error?: string };
      if (submissionGeneration !== renderLifecycleRef.current.generation) return;
      if (!res.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      if (wantPreview) {
        setPreview(data as SharePreviewResponse);
        return; // hold — the therapist confirms with a second click
      }
      setResults(data.results);
      deliveryIdempotencyKeyRef.current = null;
      // TS7.1 — remember what worked for this client so the next share
      // opens pre-set (see the open-seed effect above).
      try {
        const succeeded = successfulPreference(data.results);
        if (!succeeded) return;
        window.localStorage.setItem(
          `cm.sharePrefs.${clientId}`,
          JSON.stringify({ channels: [succeeded], ...(showLanguage && { language }) }),
        );
      } catch {
        // best-effort memory only
      }
    } catch (e) {
      if (submissionGeneration === renderLifecycleRef.current.generation) {
        setError((e as Error).message);
      }
    } finally {
      if (submissionGeneration === renderLifecycleRef.current.generation) setBusy(false);
    }
  }, [
    activeArtefact,
    clientId,
    selectedChannels,
    therapistMessage,
    showLanguage,
    language,
    needsPreviewGate,
    preview,
    takeaway,
    persistedTakeaway,
    mindSessionId,
    currentMindRequestIdentity,
    mindShareLifecycle,
  ]);

  if (!open) return null;

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center md:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-modal-title"
    >
      {/* TS7.1 — bottom sheet on phones (one-thumb reach), centered dialog
          on desktop. Same content either way. */}
      <div
        className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-6 pb-8 shadow-2xl md:rounded-2xl md:pb-6"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-4 flex items-baseline justify-between gap-3">
          <h2 id="share-modal-title" className="font-serif text-2xl">
            Send to patient
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="close"
            className="-mr-1.5 -mt-1.5 grid h-9 w-9 place-items-center rounded-full text-sm text-[var(--color-ink-2)] transition-colors hover:bg-[var(--color-surface-soft)] hover:text-[var(--color-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2"
          >
            ✕
          </button>
        </header>
        <p className="mb-4 text-sm text-[var(--color-ink-2)]">
          Sharing: <strong className="text-[var(--color-ink)]">{activeArtefactLabel}</strong>
        </p>

        {visibleResults ? (
          <ResultsView results={visibleResults} onClose={onClose} />
        ) : (
          <>
            {effectiveCandidates && effectiveCandidates.length > 0 && (
              <section className="mb-5 space-y-2">
                <p className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
                  What should the client leave with?
                </p>
                {effectiveCandidates.map((candidate, index) => (
                  <button
                    key={`${candidate.artefact.artefactType}-${index}`}
                    type="button"
                    onClick={() => setOutcomeIndex(index)}
                    aria-pressed={index === outcomeIndex}
                    className={`w-full rounded-xl border p-3 text-left text-sm ${index === outcomeIndex ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]' : 'border-[var(--color-line-soft)]'} ${candidate.secondary ? 'mt-4 text-[var(--color-ink-2)]' : ''}`}
                  >
                    {candidate.label}
                    {candidate.secondary ? ' · full clinical document' : ''}
                  </button>
                ))}
              </section>
            )}
            {activeArtefact.artefactType === 'SESSION_TAKEAWAY' && (
              <label className="mb-5 block space-y-2 text-sm">
                <span className="font-medium text-[var(--color-ink)]">Patient-facing takeaway</span>
                <textarea
                  value={visibleTakeaway}
                  onChange={(event) => setTakeaway(event.target.value.slice(0, 2000))}
                  maxLength={2000}
                  rows={4}
                  placeholder="A short, practical message written for the client"
                  className="w-full rounded-xl border border-[var(--color-line-soft)] bg-white px-3 py-2"
                />
                <span className="block text-xs text-[var(--color-ink-3)]">
                  {TAKEAWAY_EDIT_COPY} The clinical note is not relabelled.
                </span>
              </label>
            )}
            <section className="space-y-3">
              <p className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
                Preferred delivery
              </p>
              <div className="rounded-xl border border-[var(--color-accent)] bg-[var(--color-accent-soft)] p-4 text-sm font-medium">
                {ALL_CHANNELS.find((channel) => selected[channel.key])?.label ??
                  'Choose a delivery option'}
              </div>
              <details className="rounded-xl border border-[var(--color-line-soft)] p-3">
                <summary className="cursor-pointer text-sm font-medium">
                  More delivery options
                </summary>
                <div className="mt-3 space-y-3">
                  {ALL_CHANNELS.map((c) => {
                    const disabledReason =
                      c.key === 'WHATSAPP'
                        ? config && !config.whatsappConfigured
                          ? 'WhatsApp sending isn’t set up on this account.'
                          : !hasContactPhone
                            ? 'No phone on file.'
                            : null
                        : c.key === 'EMAIL'
                          ? config && !config.emailConfigured
                            ? 'Email sending isn’t set up on this account.'
                            : !hasContactEmail
                              ? 'No email on file.'
                              : null
                          : null;
                    const disabled = disabledReason !== null;
                    return (
                      <label
                        key={c.key}
                        className={`flex items-start gap-3 rounded-xl border p-4 ${
                          disabled
                            ? 'cursor-not-allowed border-[var(--color-line-soft)] bg-[var(--color-surface-soft)]'
                            : selected[c.key]
                              ? 'cursor-pointer border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
                              : 'cursor-pointer border-[var(--color-line-soft)] bg-white/40 hover:border-[var(--color-ink)]'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selected[c.key]}
                          disabled={disabled}
                          onChange={() => toggle(c.key)}
                          className="mt-0.5 h-5 w-5 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2"
                        />
                        <span className="flex-1">
                          <span
                            className={`block text-sm font-medium ${
                              disabled ? 'text-[var(--color-ink-2)]' : 'text-[var(--color-ink)]'
                            }`}
                          >
                            {c.label}
                          </span>
                          <span className="mt-0.5 block text-xs text-[var(--color-ink-3)]">
                            {c.description}
                          </span>
                          {disabledReason && (
                            <span className="mt-2 flex items-start gap-1.5 rounded-lg bg-[var(--color-warn-soft)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-warn)]">
                              <span aria-hidden="true">⚠</span>
                              <span>{disabledReason}</span>
                            </span>
                          )}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </details>
            </section>

            <section className="mt-4">
              <label className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
                Personal note (optional)
              </label>
              <textarea
                value={visibleTherapistMessage}
                onChange={(e) => setTherapistMessage(e.target.value)}
                rows={3}
                placeholder="Optional. Shown to the patient above the artefact."
                className="mt-2 w-full rounded-xl border border-[var(--color-line-soft)] bg-white/40 p-3 text-sm"
              />
            </section>

            {showLanguage && (
              <section className="mt-4">
                <label
                  htmlFor="share-language"
                  className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]"
                >
                  Language the client receives
                </label>
                <select
                  id="share-language"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-[var(--color-line-soft)] bg-white/40 p-3 text-sm text-[var(--color-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
                >
                  {SHARE_LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1.5 text-xs text-[var(--color-ink-3)]">
                  The note is translated into this language for the client. Your signed record stays
                  unchanged.
                </p>
              </section>
            )}

            {selectedChannels.length > 0 && (
              <section className="mt-4 rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-4">
                <p className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
                  Before you send
                </p>
                <p className="mt-2 text-sm text-[var(--color-ink)]">
                  Sending <strong>{activeArtefactLabel}</strong> to the client via:
                </p>
                <ul className="mt-2 space-y-1 text-sm text-[var(--color-ink-2)]">
                  {selectedChannels.map((ch) => (
                    <li key={ch} className="flex items-baseline gap-2">
                      <span aria-hidden="true" className="text-[var(--color-accent)]">
                        •
                      </span>
                      <span>{previewDestination(ch)}</span>
                    </li>
                  ))}
                </ul>
                {showLanguage && (
                  <p className="mt-3 text-sm text-[var(--color-ink)]">
                    In <strong>{shareLanguageLabel(language)}</strong>
                    {language !== 'en' ? ' (translated for the client)' : ''}.
                  </p>
                )}
              </section>
            )}

            {/* SHARE-3 — the translated text the patient will actually read,
                shown for confirmation before the send is committed. */}
            {visiblePreview && (
              <section className="mt-4 rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-ink-3)]">
                  Review — what your client reads in {shareLanguageLabel(visiblePreview.language)}
                </p>
                <p className="mt-1 text-xs text-[var(--color-ink-3)]">
                  This is a machine translation of your signed note. Check the risk wording,
                  medication instructions, and any hedged phrasing before it goes out.
                </p>
                <div className="mt-3 max-h-64 space-y-2 overflow-y-auto text-sm text-[var(--color-ink)]">
                  <TranslationPreview snapshot={visiblePreview.snapshot} />
                </div>
              </section>
            )}

            {error && (
              <div className="mt-4 rounded-2xl border border-[var(--color-warn-border)] bg-[var(--color-warn-bg)] p-3 text-sm text-[var(--color-warn)]">
                {error}
              </div>
            )}

            <footer className="mt-5 border-t border-[var(--color-line-soft)] pt-4">
              <Button
                onClick={() => void submit()}
                disabled={busy || !mindCandidatesReady}
                className="w-full"
              >
                {busy
                  ? visiblePreview
                    ? 'Sending…'
                    : 'Translating…'
                  : needsPreviewGate && !visiblePreview
                    ? 'Preview translation'
                    : visiblePreview
                      ? 'Looks right — send'
                      : 'Send'}
              </Button>
              {/* TS7.1 — an equal, guilt-free exit: the record is complete
                  whether or not anything is sent. */}
              {skipSend ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setBusy(true);
                    setError(null);
                    void Promise.resolve(skipSend())
                      .then(onClose)
                      .catch(() =>
                        setError('Could not record the sharing decision. Please try again.'),
                      )
                      .finally(() => setBusy(false));
                  }}
                  disabled={busy}
                  className="mt-2 w-full"
                >
                  Do not send
                </Button>
              ) : (
                <button
                  type="button"
                  onClick={onClose}
                  disabled={busy}
                  className="mt-2 w-full rounded-full px-4 py-2 text-sm text-[var(--color-ink-2)] hover:bg-[var(--color-surface-soft)]"
                >
                  Done — don’t send anything
                </button>
              )}
            </footer>
          </>
        )}
      </div>
    </div>
  );
}

/** SHARE-3 — render the translated, patient-facing snapshot for review. Only
 *  the two free-text note kinds are machine-translated; anything else shows a
 *  short fallback (the gate only triggers for those kinds anyway). */
function TranslationPreview({ snapshot }: { snapshot: PatientShareSnapshot }) {
  if (snapshot.kind === 'SIGNED_NOTE') {
    const fields: [string, string][] = [
      ['Subjective', snapshot.subjective],
      ['Objective', snapshot.objective],
      ['Assessment', snapshot.assessment],
      ['Plan', snapshot.plan],
    ];
    return (
      <>
        {fields.map(([label, body]) =>
          body?.trim() ? (
            <div key={label}>
              <p className="text-xs font-medium text-[var(--color-ink-2)]">{label}</p>
              <p className="whitespace-pre-wrap">{body}</p>
            </div>
          ) : null,
        )}
      </>
    );
  }
  if (snapshot.kind === 'SIGNED_INTAKE_NOTE') {
    return (
      <>
        {snapshot.sections.map((s, i) => (
          <div key={`${s.title}-${i}`}>
            <p className="text-xs font-medium text-[var(--color-ink-2)]">{s.title}</p>
            <p className="whitespace-pre-wrap">{s.body}</p>
          </div>
        ))}
      </>
    );
  }
  return <p className="text-[var(--color-ink-3)]">Preview unavailable for this artefact.</p>;
}

function ResultsView({ results, onClose }: { results: ShareResultEntry[]; onClose: () => void }) {
  // SHARE-1 — a link can be pulled back right here ("wrong person"). Track the
  // shares revoked this session so the row reflects it without a refetch.
  const [revoked, setRevoked] = useState<Set<string>>(new Set());
  const [revoking, setRevoking] = useState<Set<string>>(new Set());

  const revoke = useCallback(async (shareId: string): Promise<void> => {
    setRevoking((prev) => new Set(prev).add(shareId));
    try {
      const res = await fetch(`/api/v1/shares/${shareId}/revoke`, { method: 'POST' });
      if (res.ok) setRevoked((prev) => new Set(prev).add(shareId));
    } catch {
      /* best-effort; the button stays available to retry */
    } finally {
      setRevoking((prev) => {
        const next = new Set(prev);
        next.delete(shareId);
        return next;
      });
    }
  }, []);

  return (
    <div>
      <ul className="space-y-2">
        {results.map((r, i) => {
          const isRevoked = revoked.has(r.shareId);
          // Only a link that actually went live can be pulled back.
          const canRevoke =
            !isRevoked && !!r.portalUrl && (r.status === 'SENT' || r.status === 'OPENED');
          return (
            <li
              key={`${r.channel}-${i}`}
              className="rounded-xl border border-[var(--color-line-soft)] bg-white/40 p-4"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <strong className="text-sm">{r.channel}</strong>
                <Badge
                  tone={
                    isRevoked
                      ? 'muted'
                      : r.status === 'SENT' || r.status === 'OPENED'
                        ? 'accent'
                        : r.status === 'PENDING'
                          ? 'muted'
                          : 'warn'
                  }
                >
                  {isRevoked ? 'revoked' : r.status.toLowerCase().replace(/_/g, ' ')}
                </Badge>
              </div>
              {r.portalUrl && !isRevoked && (
                <p className="mt-2 break-all text-xs">
                  <span className="text-[var(--color-ink-3)]">Portal: </span>
                  <a
                    href={r.portalUrl}
                    className="text-[var(--color-accent)] underline"
                    rel="noopener"
                    target="_blank"
                  >
                    {r.portalUrl}
                  </a>
                  <button
                    type="button"
                    onClick={() => void navigator.clipboard.writeText(r.portalUrl)}
                    className="ml-2 rounded-full px-2 py-0.5 text-xs text-[var(--color-accent)] hover:bg-[var(--color-accent-soft)]"
                  >
                    copy
                  </button>
                </p>
              )}
              {isRevoked && (
                <p className="mt-2 text-xs text-[var(--color-ink-3)]">
                  Link revoked — the client can no longer open it.
                </p>
              )}
              {canRevoke && (
                <button
                  type="button"
                  onClick={() => void revoke(r.shareId)}
                  disabled={revoking.has(r.shareId)}
                  className="mt-2 rounded-full px-2 py-0.5 text-xs text-[var(--color-warn)] hover:bg-[var(--color-warn-bg)] disabled:opacity-50"
                >
                  {revoking.has(r.shareId) ? 'Revoking…' : 'Revoke link'}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <footer className="mt-5 flex justify-end border-t border-[var(--color-line-soft)] pt-4">
        <Button onClick={onClose}>Done</Button>
      </footer>
    </div>
  );
}
