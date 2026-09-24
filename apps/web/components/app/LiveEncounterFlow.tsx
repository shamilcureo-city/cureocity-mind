'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ContextFlash } from './ContextFlash';
import { DoctorLiveEncounter } from './DoctorLiveEncounter';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

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
  const [declining, setDeclining] = useState(false);
  const [declineError, setDeclineError] = useState<string | null>(null);

  async function declineLiveCapture(): Promise<void> {
    setDeclining(true);
    setDeclineError(null);
    try {
      const response = await fetch(`/api/v1/sessions/${sessionId}/consent`, {
        method: 'DELETE',
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? 'Could not record the consent choice.');
      router.push(
        `/app/patients/${clientId}/encounters/${sessionId}?mode=dictate&liveConsent=declined`,
      );
    } catch (error) {
      setDeclineError((error as Error).message);
      setDeclining(false);
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
      <Card className="mx-auto max-w-2xl space-y-5 p-7">
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
        <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-4 text-sm text-[var(--color-ink-2)]">
          If the patient declines live recording, do not start the microphone. You can dictate your
          own clinical summary after the visit instead; that path still requires consent for AI
          processing of the patient&rsquo;s information.
        </div>
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => setPhase('live')}>Patient agreed — open live consult</Button>
          <Button
            variant="secondary"
            disabled={declining}
            onClick={() => void declineLiveCapture()}
          >
            {declining ? 'Recording choice…' : 'Patient declined — use dictation'}
          </Button>
        </div>
        {declineError && <p className="text-sm text-[var(--color-warn)]">{declineError}</p>}
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
