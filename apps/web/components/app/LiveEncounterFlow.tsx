'use client';

import { useState } from 'react';
import { ContextFlash } from './ContextFlash';
import { DoctorLiveEncounter } from './DoctorLiveEncounter';

/**
 * Sprint DS7 — the clinic-flow entry into a live consult. When the doctor
 * arrives from the queue (`?flash=1`), a 3-second context flash plays first
 * and then the mic auto-starts; opened directly, it's just the live copilot
 * as before. See docs/DOCTOR_SCRIBE_V2_SPRINTS.md DS7.
 */
export function LiveEncounterFlow({
  sessionId,
  clientId,
  specialty,
  patient,
  showFlash,
}: {
  sessionId: string;
  clientId: string;
  specialty?: string | null;
  patient: { name: string; age: number | null };
  showFlash: boolean;
}) {
  const [phase, setPhase] = useState<'flash' | 'live'>(showFlash ? 'flash' : 'live');

  if (phase === 'flash') {
    return (
      <ContextFlash
        clientId={clientId}
        patientName={patient.name}
        age={patient.age}
        specialty={specialty}
        encounterHref={`/app/patients/${clientId}/encounters/${sessionId}`}
        onDone={() => setPhase('live')}
      />
    );
  }

  return (
    <DoctorLiveEncounter
      sessionId={sessionId}
      clientId={clientId}
      specialty={specialty}
      patient={patient}
      autoStart={showFlash}
    />
  );
}
