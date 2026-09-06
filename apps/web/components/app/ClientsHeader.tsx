'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PractitionerVertical } from '@cureocity/contracts';
import { subjectNounFor } from '@/lib/vertical';
import { CreateClientModal } from './CreateClientModal';
import { createdClientDestination } from '@/lib/client-entry-intent';

/**
 * Header for the roster page — title + create button that opens
 * CreateClientModal. Wraps the modal's open state so the page itself
 * stays a server component. Sprint DV2 — vertical-aware: doctors see
 * "Patients" + "New patient"; therapists are unchanged.
 */
export function ClientsHeader({
  vertical = 'THERAPIST',
  initiallyOpen = false,
  returnToSession = false,
  captureMode = 'LIVE',
}: {
  vertical?: PractitionerVertical;
  initiallyOpen?: boolean;
  returnToSession?: boolean;
  captureMode?: 'LIVE' | 'BATCH';
}) {
  const router = useRouter();
  const [open, setOpen] = useState(initiallyOpen);
  const isDoctor = vertical === 'DOCTOR';
  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
            Roster
          </p>
          <h1 className="mt-2 font-serif text-3xl">{subjectNounFor(vertical).Plural}</h1>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-full bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)]"
        >
          {isDoctor ? '+ New patient' : '+ Create new'}
        </button>
      </header>
      <CreateClientModal
        open={open}
        onClose={() => {
          setOpen(false);
          if (initiallyOpen) router.replace(isDoctor ? '/app/patients' : '/app/clients');
        }}
        vertical={vertical}
        redirectOnCreated={!returnToSession || isDoctor}
        onCreated={
          returnToSession && !isDoctor
            ? (client) => {
                setOpen(false);
                router.push(createdClientDestination(client.id, captureMode));
              }
            : undefined
        }
      />
    </>
  );
}
