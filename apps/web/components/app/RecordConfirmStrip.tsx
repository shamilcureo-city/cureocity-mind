'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type {
  BillingEntitlement,
  ConsentScope,
  ModalitySource,
  SessionDefaults,
  SessionKind,
  SessionModality,
  MindSessionPurpose,
} from '@cureocity/contracts';
import {
  MIND_SESSION_PURPOSE_LABELS,
  sessionKindForMindPurpose,
  mindSessionPurposeLabel,
} from '@cureocity/contracts';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { CheckboxRow, FieldError, Label, Select } from '../ui/Field';
import { InlineExplainer } from './EduHeading';
import { glossary } from '../../lib/clinical-glossary';
import { type RecordReady, SCRIPT_VERSION } from './record-types';
import { UpgradeModal } from './UpgradeModal';
import { isDisplayCaptureSupported, type CaptureSource } from '@/lib/audio/use-session-recorder';
import { MindSessionPreflight } from './MindSessionPreflight';
import { PreparePanel } from './PreparePanel';
import { formatIstDate } from '@/lib/ist';

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
  /**
   * TS6 — the therapist's preferred capture for in-person sessions: live
   * scribe vs record-only (batch). Preselects the toggle; never removes a
   * path. From Psychologist.defaultCaptureMode (non-LIVE ⇒ BATCH).
   */
  defaultCapture?: 'LIVE' | 'BATCH';
  /**
   * VS1 — server-computed livekitConfigured(). When false the Virtual
   * option is disabled up front, BEFORE a session is created, consented and
   * started toward a dead video surface.
   */
  videoEnabled?: boolean;
  expectedSessionId?: string | null;
  initialGuideId?: string;
  onCancel: () => void;
  onReady: (result: RecordReady) => void;
}

const KIND_BUTTON_LABEL: Record<SessionKind, string> = {
  INTAKE: 'Start assessment',
  TREATMENT: 'Start recording',
  REVIEW: 'Start review',
};

const KIND_SUBLINE: Record<SessionKind, (defaults: SessionDefaults) => string> = {
  INTAKE: () => 'No modality yet — that’s the point of intake.',
  TREATMENT: (d) => {
    const last = d.lastCompletedSessionAt ?? null;
    if (!last) return 'Continuing per the active plan.';
    return `Last completed session: ${formatIstDate(last)} (IST).`;
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
  defaultCapture = 'LIVE',
  videoEnabled = true,
  expectedSessionId = null,
  initialGuideId,
  onCancel,
  onReady,
}: Props) {
  const router = useRouter();
  const [defaults, setDefaults] = useState<SessionDefaults | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [modality, setModality] = useState<SessionModality | null>(null);
  const [language, setLanguage] = useState<string>('en');
  // VS1 — 'room' routes to the virtual surface (LiveKit room + client link +
  // the scribe fed by the call audio). 'display' remains the own-Meet/Zoom
  // tab-audio escape hatch.
  const [method, setMethod] = useState<CaptureSource | 'room'>(
    mode === 'dictation' ? 'dictation' : 'mic',
  );
  // TS6 — for in-person (mic) capture the therapist chooses: live scribe
  // (transcript + note build as you talk) or record-only (batch note after).
  const [capture, setCapture] = useState<'live' | 'batch'>(
    defaultCapture === 'BATCH' ? 'batch' : 'live',
  );
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
  const startingRef = useRef<AbortController | null>(null);
  useEffect(() => () => startingRef.current?.abort(), []);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [preflightReady, setPreflightReady] = useState(false);
  const [confirmedToday, setConfirmedToday] = useState(false);
  const [manual, setManual] = useState(false);
  const [purpose, setPurpose] = useState<MindSessionPurpose | ''>('');
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [preparedGuides, setPreparedGuides] = useState<
    Array<{ id: string; name: string; updatedAt: string }>
  >([]);
  const [guideId, setGuideId] = useState('');
  const [guideLoading, setGuideLoading] = useState(true);
  const [guideError, setGuideError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setPreparedGuides([]);
    setGuideId(initialGuideId ?? '');
    setGuideLoading(true);
    setGuideError(false);
    void (async () => {
      try {
        const response = await fetch(`/api/v1/clients/${clientId}/session-defaults?guides=1`, {
          cache: 'no-store',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
        });
        if (!response.ok) throw new Error('Guide list unavailable');
        const body = (await response.json()) as {
          guides?: Array<{ id: string; name: string; updatedAt: string }>;
        };
        if (!Array.isArray(body.guides)) throw new Error('Invalid guide list');
        if (controller.signal.aborted) return;
        setPreparedGuides(body.guides);
        setGuideId(body.guides.some((guide) => guide.id === initialGuideId) ? initialGuideId! : '');
      } catch {
        if (!controller.signal.aborted) {
          setGuideError(true);
          setGuideId('');
        }
      } finally {
        if (!controller.signal.aborted) setGuideLoading(false);
      }
    })();
    return () => controller.abort();
  }, [clientId, initialGuideId]);

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
          // ALL required scopes are surfaced — including
          // CROSS_BORDER_PROCESSING: Pass 2+ analysis runs on Google's
          // global endpoint, so a session cannot start without that
          // consent on record (the server enforces it at /start).
          missing[scope] = false;
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
    if (!defaults || startingRef.current) return;
    const controller = new AbortController();
    startingRef.current = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]);
    setSubmitError(null);
    setSubmitting(true);
    try {
      const createRes = await fetch('/api/v1/sessions', {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          modality: modality ?? undefined,
          // FLOW-3 — send the chosen note language so it's persisted on the
          // session (was dropped, so every note generated in English).
          language,
          ...(purpose ? { mindPurpose: purpose } : {}),
          ...(manual ? { mindDocumentationMode: 'MANUAL' } : {}),
          scheduledAt: new Date().toISOString(),
          // TS3 (F1) — starting now: reuse today's booked session for this
          // client instead of minting a duplicate that orphans the slot.
          startNow: true,
          ...(expectedSessionId ? { expectedSessionId } : {}),
        }),
      });
      signal.throwIfAborted();
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
        updatedAt: string;
        mindDocumentationMode?: string | null;
      };
      signal.throwIfAborted();
      if (expectedSessionId && sessionRow.id !== expectedSessionId) {
        throw new Error(
          'The booked session changed while preflight was open. Return to Today and try again.',
        );
      }

      // Manual visits never acknowledge technology consent, mint a live token,
      // ask for a microphone or call the audio/AI lifecycle.
      if (manual || sessionRow.mindDocumentationMode === 'MANUAL') {
        const response = await fetch(`/api/v1/sessions/${sessionRow.id}/manual-note`, {
          method: 'POST',
          signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operation: 'start',
            expectedUpdatedAt: sessionRow.updatedAt,
            ...(purpose ? { mindPurpose: purpose } : {}),
          }),
        });
        const result = (await response.json()) as { error?: string };
        if (!response.ok)
          throw new Error(result.error ?? 'Could not open your clinician-written note.');
        signal.throwIfAborted();
        router.push(`/app/sessions/${sessionRow.id}`);
        return;
      }

      // TS3 (F1) fix — the create call may have REUSED an already-started
      // session (e.g. a live consult begun earlier today). Consent + /start
      // only apply to a not-yet-started SCHEDULED session — the consent route
      // rejects IN_PROGRESS ("Cannot record consent on a session in
      // IN_PROGRESS state"), and a reused IN_PROGRESS session already has its
      // consent snapshot. Skip both when it's already running.
      const alreadyStarted = sessionRow.status === 'IN_PROGRESS';

      if (!alreadyStarted) {
        // Per-session consent: re-ack everything already granted (at signup or
        // on the client's record) plus anything the therapist ticked here. A
        // scope ticked here is persisted server-side as the client's standing
        // consent (the /consent route upserts the Consent row), so it is asked
        // at most once — not per session.
        const acked = new Set<ConsentScope>(defaults.consentsAlreadyGranted);
        for (const [scope, ticked] of Object.entries(missingRequired)) {
          if (ticked) acked.add(scope as ConsentScope);
        }

        const consentRes = await fetch(`/api/v1/sessions/${sessionRow.id}/consent`, {
          method: 'POST',
          signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scopes: Array.from(acked),
            scriptVersion: SCRIPT_VERSION,
          }),
        });
        signal.throwIfAborted();
        if (!consentRes.ok) {
          const body = (await consentRes.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `Record consent failed (${consentRes.status})`);
        }
      }

      // TS3 (F1) → TS6 — in-person live capture goes to the live scribe
      // (transcript + note build as you talk, like the doctor consult) ONLY
      // when the therapist chose it — record-only stays on the batch recorder
      // (full-session audio, note generated on finish). The live page's
      // live-token call performs the SCHEDULED→IN_PROGRESS start, so we skip
      // the batch /start there. Virtual (tab-audio), dictation and upload stay
      // on the batch recorder — the live stream is mic-only for now.
      const useLiveScribe = mode === 'live-capture' && method === 'mic' && capture === 'live';
      if (useLiveScribe) {
        const mic = selectedDeviceId ? `&mic=${encodeURIComponent(selectedDeviceId)}` : '';
        const guide = guideId ? `&guide=${encodeURIComponent(guideId)}` : '';
        router.push(`/app/sessions/${sessionRow.id}/live?flash=1${mic}${guide}`);
        return;
      }

      // VS1 — Virtual: start the session (consent snapshot + IN_PROGRESS, so
      // the client's signed join link is live), then hand over to the video
      // surface — room, share link and the call-audio scribe live there.
      if (method === 'room') {
        if (!alreadyStarted) {
          const startRes = await fetch(`/api/v1/sessions/${sessionRow.id}/start`, {
            method: 'POST',
            signal,
          });
          signal.throwIfAborted();
          if (!startRes.ok) {
            const body = (await startRes.json().catch(() => ({}))) as { error?: string };
            throw new Error(body.error ?? `Start session failed (${startRes.status})`);
          }
        }
        router.push(`/app/video/session/${sessionRow.id}`);
        return;
      }

      const startAfterCaptureActive =
        !alreadyStarted && mode === 'live-capture' && (method === 'mic' || method === 'display');
      if (!alreadyStarted && !startAfterCaptureActive) {
        const startRes = await fetch(`/api/v1/sessions/${sessionRow.id}/start`, {
          method: 'POST',
          signal,
        });
        signal.throwIfAborted();
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
        source: method as CaptureSource,
        ...(selectedDeviceId ? { selectedDeviceId } : {}),
        ...(startAfterCaptureActive ? { startAfterCaptureActive: true } : {}),
      });
    } catch (err) {
      if (!controller.signal.aborted) setSubmitError((err as Error).message);
    } finally {
      startingRef.current = null;
      if (!controller.signal.aborted) setSubmitting(false);
    }
  }

  const needsDevicePreflight = !manual && mode === 'live-capture' && method === 'mic';
  const ready =
    !!defaults &&
    !loading &&
    !loadError &&
    (manual || (confirmedToday && Object.values(missingRequired).every(Boolean))) &&
    (!needsDevicePreflight || preflightReady);

  // Build the kind-aware chip line ("Treatment session · CBT · English").
  // INTAKE intentionally omits the modality chip.
  const selectedKind = purpose ? sessionKindForMindPurpose(purpose) : defaults?.kind;
  const isIntake = selectedKind === 'INTAKE';
  const chipParts: string[] = [];
  if (defaults) {
    chipParts.push(mindSessionPurposeLabel(purpose, selectedKind ?? defaults.kind));
    if (!isIntake && modality) chipParts.push(MODALITY_LABEL[modality]);
    chipParts.push(LANGUAGE_LABEL[language] ?? language);
  }

  return (
    <Card className="p-7">
      <button
        type="button"
        onClick={onCancel}
        disabled={submitting}
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
            {purpose
              ? 'Today’s purpose is your choice. The note format follows it; no diagnosis is created by selecting a purpose.'
              : KIND_SUBLINE[defaults.kind](defaults)}
          </p>

          {mode === 'live-capture' && <PreparePanel clientId={clientId} summaryVisible />}

          <details className="mt-5 rounded-2xl border border-[var(--color-line)] p-4">
            <summary className="cursor-pointer text-sm font-medium">
              Today’s purpose ·{' '}
              {purpose ? MIND_SESSION_PURPOSE_LABELS[purpose] : 'Choose what fits this visit'}
            </summary>
            <Label htmlFor="rcs-purpose">What are you and the client working on today?</Label>
            <Select
              id="rcs-purpose"
              value={purpose}
              onChange={(event) => setPurpose(event.target.value as MindSessionPurpose | '')}
            >
              <option value="">Use the suggested session purpose</option>
              {Object.entries(MIND_SESSION_PURPOSE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            <p className="mt-2 text-xs text-[var(--color-ink-3)]">
              Assessment can continue over several visits. Counselling does not require a diagnosis.
            </p>
          </details>

          {mode === 'live-capture' && (
            <div
              className="mt-5 grid gap-3 sm:grid-cols-2"
              role="group"
              aria-label="How to document this session"
            >
              <MethodOption
                groupName="documentation"
                checked={!manual}
                onSelect={() => setManual(false)}
                title="Use the scribe"
                description="Record with the client’s permission and review AI-assisted notes."
              />
              <MethodOption
                groupName="documentation"
                checked={manual}
                onSelect={() => setManual(true)}
                title="Write my own note"
                description="No recording. No AI processing. Save securely and sign when ready."
              />
            </div>
          )}

          {!manual && mode === 'live-capture' && (
            <details className="mt-5 rounded-2xl border border-[var(--color-line)] p-4">
              <summary className="cursor-pointer text-sm font-medium text-[var(--color-ink)]">
                {method === 'mic'
                  ? 'In person'
                  : method === 'room'
                    ? 'Virtual room'
                    : 'Own Meet/Zoom'}
                {' · '}
                {method === 'mic' && capture === 'live' ? 'Live scribe' : 'Record only'}
                {guideId && method === 'mic' && capture === 'live' ? ' · Guide selected' : ''}
                <span className="ml-3 text-[var(--color-accent)] underline">
                  Change recording settings
                </span>
              </summary>
              {mode === 'live-capture' && (
                <div className="mt-6">
                  <Label>Recording method</Label>
                  <div
                    role="radiogroup"
                    aria-label="Recording method"
                    className="mt-2 grid gap-2 sm:grid-cols-3"
                  >
                    <MethodOption
                      groupName="rcs-recording-method"
                      checked={method === 'mic'}
                      onSelect={() => setMethod('mic')}
                      title="In person"
                      description="Client in the room — this device's microphone."
                    />
                    <MethodOption
                      groupName="rcs-recording-method"
                      checked={method === 'room'}
                      onSelect={() => setMethod('room')}
                      title="Virtual"
                      description={
                        videoEnabled
                          ? 'Video room in Cureocity — the client joins by a link you share.'
                          : 'In-app video is not configured on this deployment.'
                      }
                      disabled={!videoEnabled}
                    />
                    <MethodOption
                      groupName="rcs-recording-method"
                      checked={method === 'display'}
                      onSelect={() => setMethod('display')}
                      title="Own Meet/Zoom"
                      description="Your own video app — captures the tab's audio."
                      disabled={!displaySupported}
                    />
                  </div>
                </div>
              )}

              {/* TS6 — the capture choice, doctor-style: live scribe or record-
              only. Mic-only (the live stream doesn't take tab audio yet). */}
              {mode === 'live-capture' && method === 'mic' && (
                <div className="mt-5">
                  <Label>During the session</Label>
                  <div
                    role="radiogroup"
                    aria-label="During the session"
                    className="mt-2 grid gap-2 sm:grid-cols-2"
                  >
                    <MethodOption
                      groupName="rcs-capture-mode"
                      checked={capture === 'live'}
                      onSelect={() => setCapture('live')}
                      title="Live scribe"
                      description="Transcript, note and copilot build on screen as you talk."
                    />
                    <MethodOption
                      groupName="rcs-capture-mode"
                      checked={capture === 'batch'}
                      onSelect={() => setCapture('batch')}
                      title="Record only"
                      description="Just records — the note generates when you finish."
                    />
                  </div>
                </div>
              )}

              {mode === 'live-capture' && method === 'mic' && capture === 'live' && (
                <section className="mt-5 space-y-2" aria-label="Optional session support">
                  <Label htmlFor="rcs-guide">Session support (optional)</Label>
                  <Select
                    id="rcs-guide"
                    value={guideId}
                    onChange={(event) => setGuideId(event.target.value)}
                    disabled={guideLoading || guideError}
                  >
                    <option value="">Quiet focus — no guide selected</option>
                    {guideLoading && guideId && (
                      <option value={guideId}>
                        Selected prepared guide — checking availability
                      </option>
                    )}
                    {preparedGuides.map((guide) => (
                      <option key={guide.id} value={guide.id}>
                        {guide.name} ·{' '}
                        {new Date(guide.updatedAt).toLocaleDateString('en-IN', {
                          timeZone: 'Asia/Kolkata',
                          day: 'numeric',
                          month: 'short',
                        })}
                      </option>
                    ))}
                  </Select>
                  <p className="text-xs text-[var(--color-ink-3)]" role="status">
                    {guideLoading
                      ? 'Checking previously prepared guides…'
                      : guideError
                        ? 'Prepared guides could not be loaded. You can continue in quiet focus.'
                        : guideId
                          ? 'The draft guide opens with your session. Review its fit before using it; this does not confirm treatment.'
                          : 'Stay with the client, or choose a previously prepared guide. This does not generate new advice.'}
                  </p>
                  <Link
                    href={`/app/clients/${clientId}/plan#session-guides`}
                    className="inline-block py-1 text-xs text-[var(--color-accent)] underline"
                  >
                    Prepare a guide before recording
                  </Link>
                </section>
              )}
            </details>
          )}

          {!manual && (
            <div className="mt-6 rounded-xl border border-[var(--color-line-soft)] p-3">
              <CheckboxRow
                id="rcs-today-confirmation"
                checked={confirmedToday}
                onChange={setConfirmedToday}
                label="The client confirmed recording and AI note processing for today’s session"
                description="Required for this session. This is separate from their standing processing preference."
              />
            </div>
          )}

          <MindSessionPreflight
            enabled={
              confirmedToday &&
              needsDevicePreflight &&
              Object.values(missingRequired).every(Boolean)
            }
            liveServiceRequired={method === 'mic' && capture === 'live'}
            onReadyChange={setPreflightReady}
            onSelectedDeviceIdChange={setSelectedDeviceId}
          />

          {/* Required-but-not-yet-granted consents (rare — new client
              flow handles the common case). */}
          {!manual && Object.keys(missingRequired).length > 0 && (
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
                        : scope === 'AI_NOTE_GENERATION'
                          ? 'AI note generation — they’ve agreed today'
                          : 'AI analysis outside India (the transcript, not the audio) — they’ve agreed today'
                    }
                  />
                ))}
              </div>
            </div>
          )}

          {!manual && (
            <p className="mt-5 text-xs leading-relaxed text-[var(--color-ink-3)]">
              {defaults.consentsAlreadyGranted.length > 0
                ? 'Recording and AI notes were agreed at signup. Audio is processed in India and deleted after 30 days; AI note analysis may process the transcript outside India, under the consent on file.'
                : 'Consent is pending — please tick the boxes above before you start.'}
            </p>
          )}
          {manual && (
            <p className="mt-5 text-sm text-[var(--color-ink-2)]">
              Stay with the client and write only what you assessed or agreed. Your counselling
              agreement still applies; no recording or AI permissions are granted by this choice.
            </p>
          )}

          <FieldError message={submitError} />

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setShowDetails((v) => !v)}
              aria-expanded={showDetails}
              className="text-sm text-[var(--color-accent)] underline"
            >
              {showDetails ? 'Hide details' : 'Change details'}
            </button>
            <Button onClick={start} disabled={!ready || submitting}>
              {submitting
                ? 'Starting…'
                : manual
                  ? 'Start without recording'
                  : mode === 'upload'
                    ? 'Choose file'
                    : mode === 'dictation'
                      ? 'Start dictation'
                      : KIND_BUTTON_LABEL[selectedKind ?? defaults.kind]}
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
  groupName,
  checked,
  onSelect,
  title,
  description,
  disabled,
}: {
  groupName: string;
  checked: boolean;
  onSelect: () => void;
  title: string;
  description: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={`relative cursor-pointer rounded-2xl border px-4 py-3 text-left transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--color-accent)] ${
        disabled
          ? 'cursor-not-allowed border-[var(--color-line)] opacity-60'
          : checked
            ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
            : 'border-[var(--color-line)] hover:border-[var(--color-ink)]'
      }`}
    >
      <span className="flex items-center gap-2 text-sm font-medium text-[var(--color-ink)]">
        <input
          type="radio"
          name={groupName}
          value={title}
          checked={checked}
          disabled={disabled}
          onChange={onSelect}
          className="h-4 w-4 accent-[var(--color-accent)]"
        />
        {title}
      </span>
      <p className="mt-1 text-xs text-[var(--color-ink-3)]">{description}</p>
      {disabled && (
        <span className="absolute right-3 top-3 rounded-full bg-[var(--color-warn-soft)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--color-warn)]">
          Unavailable
        </span>
      )}
    </label>
  );
}
