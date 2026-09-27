'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SessionConsentSnapshotSchema } from '@cureocity/contracts';
import { ContextFlash } from './ContextFlash';
import { DoctorLiveEncounter } from './DoctorLiveEncounter';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

const CONSENT_OPTIONS = [
  [
    'AUDIO_RECORDING',
    'The patient agrees to microphone capture and transcription for this consultation.',
  ],
  ['AI_NOTE_GENERATION', 'The patient agrees to AI-assisted notes from this consultation.'],
  [
    'CROSS_BORDER_PROCESSING',
    'The patient agrees to AI processing of their information outside India.',
  ],
] as const;
const SCRIPT_VERSION = 'v1.0';
class ConsentSaveError extends Error {}

/**
 * Sprint DS7 — the clinic-flow entry into a live consult. When the doctor
 * arrives from the queue (`?flash=1`), a 3-second context flash plays first,
 * followed by an explicit encounter-level consent choice. The mic never
 * auto-starts. See docs/DOCTOR_SCRIBE_V2_SPRINTS.md DS7.
 */
export function LiveEncounterFlow({
  sessionId,
  sessionStatus,
  clientId,
  specialty,
  patient,
  showFlash,
}: {
  sessionId: string;
  sessionStatus: string;
  clientId: string;
  specialty?: string | null;
  patient: { name: string; age: number | null };
  showFlash: boolean;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<'flash' | 'consent' | 'live'>(
    sessionStatus === 'IN_PROGRESS' ? 'live' : showFlash ? 'flash' : 'consent',
  );
  const [checks, setChecks] = useState(CONSENT_OPTIONS.map(() => false));
  const [saving, setSaving] = useState<'agree' | 'decline' | null>(null);
  const [consentError, setConsentError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const request = useRef<AbortController | null>(null);
  const allConfirmed = checks.every(Boolean);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort();
    };
  }, []);

  async function confirmLiveCapture(): Promise<void> {
    if (inFlight.current || !allConfirmed || sessionStatus !== 'SCHEDULED') return;
    inFlight.current = true;
    setSaving('agree');
    setConsentError(null);
    const controller = new AbortController();
    request.current = controller;
    try {
      const response = await fetch(`/api/v1/sessions/${sessionId}/consent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          scopes: CONSENT_OPTIONS.map(([scope]) => scope),
          scriptVersion: SCRIPT_VERSION,
        }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
      });
      if (!response.ok) throw new ConsentSaveError(consentSaveError(response.status));
      const body = (await response.json()) as {
        id?: unknown;
        status?: unknown;
        consentSnapshot?: unknown;
      } | null;
      const snapshot = SessionConsentSnapshotSchema.safeParse(body?.consentSnapshot);
      if (
        body?.id !== sessionId ||
        body.status !== 'SCHEDULED' ||
        !snapshot.success ||
        !CONSENT_OPTIONS.every(([scope]) =>
          snapshot.data.entries.some(
            (entry) => entry.scope === scope && entry.scriptVersion === SCRIPT_VERSION,
          ),
        )
      ) {
        throw new ConsentSaveError(
          'The consent save could not be verified. Recording is off. Please retry.',
        );
      }
      if (!mounted.current || controller.signal.aborted) return;
      // Saving consent never starts capture. The doctor must press Start next,
      // where the server rechecks the snapshot and current standing grants.
      setPhase('live');
    } catch (error) {
      if (!mounted.current || controller.signal.aborted) return;
      setConsentError(
        error instanceof ConsentSaveError
          ? error.message
          : 'The consent save was not confirmed. Recording is off. Check your connection and retry.',
      );
    } finally {
      inFlight.current = false;
      if (mounted.current) setSaving(null);
    }
  }

  async function declineLiveCapture(): Promise<void> {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving('decline');
    setConsentError(null);
    const controller = new AbortController();
    request.current = controller;
    try {
      const response = await fetch(`/api/v1/sessions/${sessionId}/consent`, {
        method: 'DELETE',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
      });
      if (!response.ok) throw new ConsentSaveError(consentSaveError(response.status));
      if (!mounted.current || controller.signal.aborted) return;
      router.push(
        `/app/patients/${clientId}/encounters/${sessionId}?mode=dictate&liveConsent=declined`,
      );
    } catch (error) {
      if (!mounted.current || controller.signal.aborted) return;
      setConsentError(
        error instanceof ConsentSaveError
          ? error.message
          : 'The consent choice was not saved. Recording is off. Please retry.',
      );
    } finally {
      inFlight.current = false;
      if (mounted.current) setSaving(null);
    }
  }

  if (phase === 'flash') {
    return (
      <ContextFlash
        clientId={clientId}
        patientName={patient.name}
        age={patient.age}
        specialty={specialty}
        encounterHref={`/app/patients/${clientId}/encounters/${sessionId}`}
        onDone={() => setPhase('consent')}
      />
    );
  }

  if (phase === 'consent') {
    return (
      <Card className="mx-auto max-w-2xl space-y-5 p-7" aria-busy={saving !== null}>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-accent)]">
            Before the microphone starts
          </p>
          <h2 className="mt-1 font-serif text-2xl">Confirm the patient agreed to live capture</h2>
        </div>
        <p className="text-sm leading-relaxed text-[var(--color-ink-2)]">
          Explain in a language the patient understands that their conversation will be streamed for
          transcription and AI note generation. Audio is not stored. The clinical note is produced
          in English; verbatim source quotes remain in the language spoken.
        </p>
        <fieldset disabled={saving !== null} className="space-y-3">
          <legend className="mb-3 text-sm font-medium">
            Confirm each permission only after the patient agrees:
          </legend>
          {CONSENT_OPTIONS.map(([scope, label], index) => (
            <label key={scope} className="flex items-start gap-3 text-sm leading-relaxed">
              <input
                type="checkbox"
                checked={checks[index] ?? false}
                onChange={(event) =>
                  setChecks((previous) =>
                    previous.map((checked, i) => (i === index ? event.target.checked : checked)),
                  )
                }
                className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-accent)]"
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
        <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-4 text-sm text-[var(--color-ink-2)]">
          If the patient declines live recording, do not start the microphone. You can dictate your
          own clinical summary after the visit instead; that path still requires consent for AI
          processing of the patient&rsquo;s information.
        </div>
        <div className="flex flex-wrap gap-3">
          <Button
            onClick={() => void confirmLiveCapture()}
            disabled={!allConfirmed || saving !== null || sessionStatus !== 'SCHEDULED'}
            className="h-auto min-h-11 whitespace-normal py-2"
          >
            {saving === 'agree' ? 'Saving consent…' : 'Save consent and open live consult'}
          </Button>
          <Button
            variant="secondary"
            disabled={saving !== null}
            onClick={() => void declineLiveCapture()}
            className="h-auto min-h-11 whitespace-normal py-2"
          >
            {saving === 'decline' ? 'Recording choice…' : 'Patient declined — use dictation'}
          </Button>
        </div>
        <p className="text-xs text-[var(--color-ink-3)]">
          Saving opens the live workspace. Your microphone stays off until you press Start.
        </p>
        {consentError && (
          <p role="alert" className="text-sm text-[var(--color-warn)]">
            {consentError}
          </p>
        )}
      </Card>
    );
  }

  return (
    <DoctorLiveEncounter
      sessionId={sessionId}
      clientId={clientId}
      specialty={specialty}
      patient={patient}
      autoStart={false}
    />
  );
}

function consentSaveError(status: number): string {
  if (status === 401)
    return 'The consent choice could not be saved. Sign in again, then reopen this encounter.';
  if (status === 403)
    return 'The consent choice could not be saved. Check your account access before retrying.';
  if (status === 400 || status === 409)
    return 'The consent choice could not be saved because the encounter changed. Reload the encounter to check its status. Recording is off.';
  return 'The consent choice could not be saved. Recording is off. Please retry.';
}
