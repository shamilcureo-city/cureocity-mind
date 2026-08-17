'use client';

import { useState } from 'react';
import { CreatePatientModal } from './CreatePatientModal';

/**
 * Header for the roster page — title + create button that opens
 * CreatePatientModal. Wraps the modal's open state so the page itself
 * stays a server component. Capabilities only select optional clinical
 * fields; the roster vocabulary and route remain consistent.
 */
export function PatientRosterHeader({
  showBehavioralFields = false,
}: {
  showBehavioralFields?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
            Roster
          </p>
          <h1 className="mt-2 font-serif text-3xl">Patients</h1>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-full bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)]"
        >
          + New patient
        </button>
      </header>
      <CreatePatientModal
        open={open}
        onClose={() => setOpen(false)}
        showBehavioralFields={showBehavioralFields}
      />
    </>
  );
}
