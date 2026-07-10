'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type {
  BillingEntitlement,
  ConsentScope,
  ModalitySource,
  SessionDefaults,
  SessionKind,
  SessionModality,
} from '@cureocity/contracts';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { CheckboxRow, FieldError, Label, Select } from '../ui/Field';
import { InlineExplainer } from './EduHeading';
import { glossary } from '../../lib/clinical-glossary';
import { type RecordReady, SCRIPT_VERSION } from './record-types';
import { UpgradeModal } from './UpgradeModal';
import { isDisplayCaptureSupported, type CaptureSource } from '@/lib/audio/use-session-recorder';

type ConfirmMode = 'live-capture' | 'dictation' | 'upload';

interface Props {
  clientId: string;
  clientName: string;
  /**
   * `live-capture` → show in-person / virtual radio (the primary path).
   * `dictation`    → no radio; source locked to 'dictation'.
   * `upload`       → no radio; downstream renders FileUploadPanel.
   */
  mode?: ConfirmMode;
  onCancel: () => void;
  onReady: (result: RecordReady) => void;
}

const KIND_CHIP: Record<SessionKind, string> = {
  INTAKE: 'Intake session',
  TREATMENT: 'Treatment session',
  REVIEW: 'Plan review',
};

const KIND_BUTTON_LABEL: Record<SessionKind, string> = {
  INTAKE: 'Start intake',
  TREATMENT: 'Start recording',
  REVIEW: 'Start review',
};

const KIND_SUBLINE: Record<SessionKind, (defaults: SessionDefaults) => string> = {
  INTAKE: () => 'No modality yet — that’s the point of intake.',
  TREATMENT: (d) => {
    const last = d.lastCompletedSessionAt ?? null;
    if (!last) return 'Continuing per the active plan.';
    return `Continuing from your last session ${formatRelative(last)}.`;
  },
  REVIEW: () => 'Re-evaluation due — review the plan with them today.',
};

// Plain-language names alongside the acronym, so a therapist who doesn't
// recognise an abbreviation still understands the option.
const MODALITY_OPTIONS: { value: SessionModality; label: string }[] = [
  { value: 'CBT', label: 'CBT — Cognitive Behavioural Therapy' },
  { value: 'EMDR', label: 'EMDR — Eye Movement Desensitisation & Reprocessing' },
  { value: 'ACT', label: 'ACT — Acceptance & Commitment Therapy' },
  { value: 'IFS', label: 'IFS — Internal Family Systems' },
  { value: 'PSYCHODYNAMIC', label: 'Psychodynamic therapy' },
  { value: 'MI', label: 'MI — Motivational Interviewing' },
  { value: 'MBCT', label: 'MBCT — Mindfulness-Based Cognitive Therapy' },
  { value: 'SUPPORTIVE', label: 'Supportive counselling' },
  { value: 'OTHER', label: 'Other' },
];

const LANGUAGE_OPTIONS: { value: string; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'Hindi' },
  { value: 'ml', label: 'Malayalam' },
  { value: 'ta', label: 'Tamil' },
  { value: 'bn', label: 'Bengali' },
];

const SOURCE_PHRASE: Record<ModalitySource, string> = {
  plan: 'From their plan.',
  client: 'From their profile.',
  therapist: 'Your default.',
  'intake-fallback': 'Deferred — intake.',
  'last-resort': 'No preference yet.',
};

const MODALITY_LABEL: Record<SessionModality, string> = {
  CBT: 'CBT',
  EMDR: 'EMDR',
  ACT: 'ACT',
  IFS: 'IFS',
  PSYCHODYNAMIC: 'Psychodynamic',
  MI: 'MI',
  MBCT: 'MBCT',
  SUPPORTIVE: 'Supportive',
  INTAKE: 'Intake',
  OTHER: 'Other',
};

const LANGUAGE_LABEL: Record<string, string> = {
  en: 'English',
  hi: 'Hindi',
  ml: 'Malayalam',
  ta: 'Tamil',
  bn: 'Bengali',
};

/**
 * Sprint 23 — inline confirm for an existing client. Replaces the
 * old `PreFlightPanel` modal for the live-capture path. The therapist
 * scanned the header chip line ("Arjun Rao · Treatment session · CBT
 * · English"), picks in-person vs. virtual, and clicks Start. Modality
 * + language sit behind "Change details" so the 95% confident-default
 * case is a one-tap confirm.
 *
 * INTAKE sessions never render a modality chip or picker — the
 * cascade returns `modality: null` and the session-create route writes
 * `SESSION_MODALITY_INFERRED` with that null.
 */
export function RecordConfirmStrip({
  clientId,
  clientName,
  mode = 'live-capture',
  onCancel,
  onReady,
}: Props) {
  const router = useRouter();
  const [defaults, setDefaults] = useState<SessionDefaults | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [modality, setModality] = useState<SessionModality | null>(null);
  const [language, setLanguage] = useState<string>('en');
  const [method, setMethod] = useState<CaptureSource>(mode === 'dictation' ? 'dictation' : 'mic');
  const [displaySupported, setDisplaySupported] = useState(true);
  const [showDetails, setShowDetails] = useState(false);

  // Per-session consent: required-but-not-yet-granted scopes the
  // therapist still has to tick before starting.
  const [missingRequired, setMissingRequired] = useState<Record<string, boolean>>({});
  // Sprint 53 — surfaced when the session-create gate returns 402.
  // Sprint 56 — 402 carries a typed entitlement snapshot, no regex parse.
  const [upgradePrompt, setUpgradePrompt] = useState<{
    variant: 'TRIAL_CAP' | 'PLAN_CAP';
    entitlement: BillingEntitlement;
  } | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    setDisplaySupported(isDisplayCaptureSupported());
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await fetch(`/api/v1/clients/${clientId}/session-defaults`, {
          cache: 'no-store',
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `Could not load defaults (${res.status})`);
        }
        const payload = (await res.json()) as { defaults: SessionDefaults };
        if (cancelled) return;
        setDefaults(payload.defaults);
        setModality(payload.defaults.modality);
        setLanguage(payload.defaults.language);
        const missing: Record<string, boolean> = {};
        for (const scope of payload.defaults.consentsNeeded) {
          if (scope === 'AUDIO_RECORDING' || scope === 'AI_NOTE_GENERATION') {
            missing[scope] = false;
          }
        }
        setMissingRequired(missing);
      } catch (e) {
        if (!cancelled) setLoadError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  async function start(): Promise<void> {
    if (!defaults) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      const createRes = await fetch('/api/v1/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          modality: modality ?? undefined,
          // FLOW-3 — send the chosen note language so it's persisted on the
          // session (was dropped, so every note generated in English).
          language,
          scheduledAt: new Date().toISOString(),
          // TS3 (F1) — starting now: reuse today's booked session for this
          // client instead of minting a duplicate that orphans the slot.
          startNow: true,
        }),
      });
      if (!createRes.ok) {
        const body = (await createRes.json().catch(() => ({}))) as {
          error?: string;
          code?: string;
          entitlement?: BillingEntitlement;
        };
        if (
          createRes.status === 402 &&
          (body.code === 'TRIAL_CAP_REACHED' || body.code === 'PLAN_CAP_REACHED') &&
          body.entitlement
        ) {
          // Sprint 53/56 — soft cap. Show the in-product upgrade modal
          // and stop the create flow without writing a generic error.
          setUpgradePrompt({
            variant: body.code === 'TRIAL_CAP_REACHED' ? 'TRIAL_CAP' : 'PLAN_CAP',
            entitlement: body.entitlement,
          });
          return;
        }
        throw new Error(body.error ?? `Create session failed (${createRes.status})`);
      }
      const sessionRow = (await createRes.json()) as {
        id: string;
        kind: SessionKind;
        modality: SessionModality | null;
        status?: string;
      };

      // TS3 (F1) fix — the create call may have REUSED an already-started
      // session (e.g. a live consult begun earlier today). Consent + /start
      // only apply to a not-yet-started SCHEDULED session — the consent route
      // rejects IN_PROGRESS ("Cannot record consent on a session in
      // IN_PROGRESS state"), and a reused IN_PROGRESS session already has its
      // consent snapshot. Skip both when it's already running.
      const alreadyStarted = sessionRow.status === 'IN_PROGRESS';

      if (!alreadyStarted) {
        // Per-session consent: re-ack everything already granted (at signup or
        // on the client's record) plus anything the therapist ticked here. The
        // data-residency / retention consents are NOT a per-session decision —
        // they're the client's standing consent (captured with a proper
        // explanation when the client is added), so we simply honour whatever
        // is on file rather than re-prompting a therapist who can't be expected
        // to weigh data-residency per session.
        const acked = new Set<ConsentScope>(defaults.consentsAlreadyGranted);
        for (const [scope, ticked] of Object.entries(missingRequired)) {
          if (ticked) acked.add(scope as ConsentScope);
        }

        const consentRes = await fetch(`/api/v1/sessions/${sessionRow.id}/consent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scopes: Array.from(acked),
            scriptVersion: SCRIPT_VERSION,
          }),
        });
        if (!consentRes.ok) {
          const body = (await consentRes.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `Record consent failed (${consentRes.status})`);
        }
      }

      // TS3 (F1) — in-person live capture goes to the live scribe (transcript
      // + note build as you talk, like the doctor consult). The live page's
      // live-token call performs the SCHEDULED→IN_PROGRESS start, so we skip
      // the batch /start here. Virtual (tab-audio), dictation and upload stay
      // on the batch recorder — the live stream is mic-only for now.
      const useLiveScribe = mode === 'live-capture' && method === 'mic';
      if (useLiveScribe) {
        router.push(`/app/sessions/${sessionRow.id}/live?flash=1`);
        return;
      }

      if (!alreadyStarted) {
        const startRes = await fetch(`/api/v1/sessions/${sessionRow.id}/start`, { method: 'POST' });
        if (!startRes.ok) {
          const body = (await startRes.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `Start session failed (${startRes.status})`);
        }
      }

      onReady({
        sessionId: sessionRow.id,
        clientId,
        clientName,
        kind: sessionRow.kind,
        modality: sessionRow.modality,
        source: method,
      });
    } catch (err) {
      setSubmitError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const ready =
    !!defaults && !loading && !loadError && Object.values(missingRequired).every(Boolean);

  // Build the kind-aware chip line ("Treatment session · CBT · English").
  // INTAKE intentionally omits the modality chip.
  const isIntake = defaults?.kind === 'INTAKE';
  const chipParts: string[] = [];
  if (defaults) {
    chipParts.push(KIND_CHIP[defaults.kind]);
    if (!isIntake && modality) chipParts.push(MODALITY_LABEL[modality]);
    chipParts.push(LANGUAGE_LABEL[language] ?? language);
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

      <h2 className="font-serif text-2xl">{clientName}</h2>
      {loading && <p className="mt-2 text-sm text-[var(--color-ink-3)]">Loading their context…</p>}
      {loadError && <FieldError message={loadError} />}

      {defaults && !loading && !loadError && (
        <>
          <p className="mt-1 text-sm text-[var(--color-ink-2)]">{chipParts.join(' · ')}</p>
          <p className="mt-1 text-xs text-[var(--color-ink-3)]">
            {KIND_SUBLINE[defaults.kind](defaults)}
          </p>

          {mode === 'live-capture' && (
            <div className="mt-6">
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
          )}

          {/* Required-but-not-yet-granted consents (rare — new client
              flow handles the common case). */}
          {Object.keys(missingRequired).length > 0 && (
            <div className="mt-6">
              <Label>Consent (new for this client)</Label>
              <div className="mt-2 space-y-2">
                {Object.keys(missingRequired).map((scope) => (
                  <CheckboxRow
                    key={scope}
                    id={`rcs-${scope}`}
                    checked={missingRequired[scope] ?? false}
                    onChange={(v) => setMissingRequired((p) => ({ ...p, [scope]: v }))}
                    label={
                      scope === 'AUDIO_RECORDING'
                        ? 'Audio recording — they’ve agreed today'
                        : 'AI note generation — they’ve agreed today'
                    }
                  />
                ))}
              </div>
            </div>
          )}

          <p className="mt-5 text-xs leading-relaxed text-[var(--color-ink-3)]">
            {defaults.consentsAlreadyGranted.length > 0
              ? 'Recording and AI notes were agreed at signup. Everything stays private and in India, and the recording is deleted after 30 days.'
              : 'Recording and AI-note consent is pending — please tick the boxes above before you start.'}
          </p>

          <FieldError message={submitError} />

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setShowDetails((v) => !v)}
              className="text-sm text-[var(--color-accent)] underline"
            >
              {showDetails ? 'Hide details' : 'Change details'}
            </button>
            <Button onClick={start} disabled={!ready || submitting}>
              {submitting
                ? 'Starting…'
                : mode === 'upload'
                  ? 'Choose file'
                  : mode === 'dictation'
                    ? 'Start dictation'
                    : KIND_BUTTON_LABEL[defaults.kind]}
            </Button>
          </div>

          {showDetails && (
            <div className="mt-5 grid gap-4 border-t border-[var(--color-line-soft)] pt-5 sm:grid-cols-2">
              {!isIntake && (
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="rcs-modality">Therapy style</Label>
                    <InlineExplainer entry={glossary('modality')} label="What's this?" />
                  </div>
                  <Select
                    id="rcs-modality"
                    value={modality ?? ''}
                    onChange={(e) =>
                      setModality((e.target.value || null) as SessionModality | null)
                    }
                  >
                    {MODALITY_OPTIONS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </Select>
                  <p className="mt-1 text-xs text-[var(--color-ink-3)]">
                    {SOURCE_PHRASE[defaults.modalitySource]}
                  </p>
                </div>
              )}
              <div>
                <Label htmlFor="rcs-language">Note language</Label>
                <Select
                  id="rcs-language"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                >
                  {LANGUAGE_OPTIONS.map((l) => (
                    <option key={l.value} value={l.value}>
                      {l.label}
                    </option>
                  ))}
                </Select>
                <p className="mt-1 text-xs text-[var(--color-ink-3)]">Their preferred language.</p>
              </div>
            </div>
          )}
        </>
      )}
      {upgradePrompt && (
        <UpgradeModal
          open={true}
          onClose={() => setUpgradePrompt(null)}
          variant={upgradePrompt.variant}
          entitlement={upgradePrompt.entitlement}
        />
      )}
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

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'recently';
  const diff = Date.now() - then;
  const day = 24 * 60 * 60 * 1000;
  if (diff < day) return 'today';
  if (diff < 2 * day) return 'yesterday';
  const days = Math.round(diff / day);
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  return months === 1 ? '1 month ago' : `${months} months ago`;
}
