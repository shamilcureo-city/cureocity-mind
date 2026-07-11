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
  useModalA11y(open, dialogRef, onClose);

  // Reset state when modal closes.
  useEffect(() => {
    if (!open) {
      setError(null);
      setResults(null);
      setBusy(false);
      setPreview(null);
    }
  }, [open]);

  // SHARE-3 — a stale translation preview must not survive a language change
  // (the therapist would confirm text that isn't what will be sent).
  useEffect(() => {
    setPreview(null);
  }, [language]);

  // Seed the language from the client's preference each time the modal opens.
  useEffect(() => {
    if (open) setLanguage(coerceShareLanguage(defaultLanguage));
  }, [open, defaultLanguage]);

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
  }, [open, hasContactPhone, hasContactEmail]);

  const toggle = useCallback((key: PatientShareChannel) => {
    setSelected((s) => ({ ...s, [key]: !s[key] }));
  }, []);

  const selectedChannels = useMemo(
    () => ALL_CHANNELS.filter((c) => selected[c.key]).map((c) => c.key),
    [selected],
  );

  // SHARE-3 — a signed note shared in a non-English language is machine-
  // translated at send time. Gate the send behind a preview the therapist
  // must confirm, so risk language / med instructions / hedged formulations
  // aren't sent in a language they never saw. Other artefacts localise
  // deterministically (pre-translated catalogs) and don't need the gate.
  const translatableNote =
    artefact.artefactType === 'SIGNED_NOTE' || artefact.artefactType === 'SIGNED_INTAKE_NOTE';
  const needsPreviewGate = showLanguage && language !== 'en' && translatableNote;

  const submit = useCallback(async () => {
    if (selectedChannels.length === 0) {
      setError('Pick at least one channel.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // First click on a non-English note fetches the preview instead of
      // sending; the therapist reviews it, then a second click confirms.
      const wantPreview = needsPreviewGate && preview === null;
      const res = await fetch('/api/v1/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          channels: selectedChannels,
          ...(therapistMessage.trim().length > 0 && { therapistMessage: therapistMessage.trim() }),
          ...(showLanguage && { language }),
          artefact,
          ...(wantPreview && { preview: true }),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as ShareResponse &
        SharePreviewResponse & { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      if (wantPreview) {
        setPreview(data as SharePreviewResponse);
        return; // hold — the therapist confirms with a second click
      }
      setResults(data.results);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [
    artefact,
    clientId,
    selectedChannels,
    therapistMessage,
    showLanguage,
    language,
    needsPreviewGate,
    preview,
  ]);

  if (!open) return null;

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-modal-title"
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl"
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
          Sharing: <strong className="text-[var(--color-ink)]">{artefactLabel}</strong>
        </p>

        {results ? (
          <ResultsView results={results} onClose={onClose} />
        ) : (
          <>
            <section className="space-y-3">
              <p className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">Channels</p>
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
            </section>

            <section className="mt-4">
              <label className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
                Personal note (optional)
              </label>
              <textarea
                value={therapistMessage}
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
                  Sending <strong>{artefactLabel}</strong> to the client via:
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
            {preview && (
              <section className="mt-4 rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-ink-3)]">
                  Review — what your client reads in {shareLanguageLabel(preview.language)}
                </p>
                <p className="mt-1 text-xs text-[var(--color-ink-3)]">
                  This is a machine translation of your signed note. Check the risk wording,
                  medication instructions, and any hedged phrasing before it goes out.
                </p>
                <div className="mt-3 max-h-64 space-y-2 overflow-y-auto text-sm text-[var(--color-ink)]">
                  <TranslationPreview snapshot={preview.snapshot} />
                </div>
              </section>
            )}

            {error && (
              <div className="mt-4 rounded-2xl border border-[var(--color-warn-border)] bg-[var(--color-warn-bg)] p-3 text-sm text-[var(--color-warn)]">
                {error}
              </div>
            )}

            <footer className="mt-5 flex items-center justify-end gap-2 border-t border-[var(--color-line-soft)] pt-4">
              <Button variant="secondary" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={() => void submit()} disabled={busy}>
                {busy
                  ? preview
                    ? 'Sending…'
                    : 'Translating…'
                  : needsPreviewGate && !preview
                    ? 'Preview translation'
                    : preview
                      ? 'Looks right — send'
                      : 'Send'}
              </Button>
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
              {r.errorDetail && (
                <p className="mt-2 text-xs text-[var(--color-warn)]">{r.errorDetail}</p>
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
