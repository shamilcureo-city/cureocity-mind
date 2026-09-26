'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { ScribeBriefing } from '@/lib/scribe-preparation-contracts';
import { intakeVitalsText } from '@/lib/scribe-intake-contracts';
import { Button } from '../ui/Button';
import { useScribeFetch } from './ScribeTransport';

export function ScribeBriefingCard({ clientId }: { clientId: string }) {
  const request = useScribeFetch();
  const [loaded, setLoaded] = useState<{ clientId: string; data: ScribeBriefing } | null>(null);
  const data = loaded?.clientId === clientId ? loaded.data : null;
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoaded(null);
    setError(false);
    void request(`/api/v1/clients/${clientId}/scribe-briefing`, {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Briefing unavailable');
        const body = (await response.json()) as ScribeBriefing;
        if (!controller.signal.aborted) setLoaded({ clientId, data: body });
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [clientId, attempt, request]);
  return (
    <section
      aria-label="Patient at a glance"
      className="space-y-3 rounded-xl border border-[var(--color-line)] bg-white p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold">Patient at a glance</h3>
        <Button size="sm" variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
          Refresh
        </Button>
      </div>
      <p className="text-xs text-[var(--color-ink-3)]">
        Dated, signed history — verify what is still current today.
      </p>
      {error ? (
        <div role="alert">
          History could not be loaded. Do not assume there is none.{' '}
          <Button size="sm" variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
            Retry
          </Button>
        </div>
      ) : !data ? (
        <p role="status">Loading signed history…</p>
      ) : (
        <>
          <p className="text-sm">
            <strong>Allergies: </strong>
            {data.allergies.status === 'not_recorded'
              ? 'Not recorded — not the same as no allergies.'
              : data.allergies.entries.join('; ')}
          </p>
          {data.intake && (
            <div className="rounded-xl bg-[var(--color-surface-soft)] p-3 text-sm">
              <p className="font-medium">
                Submitted concern · {new Date(data.intake.submittedAt).toLocaleString('en-IN')}
              </p>
              <p className="mt-1 whitespace-pre-wrap">{data.intake.reasonForVisit}</p>
              <p className="mt-1 text-xs">
                Self-reported {data.intake.authorRole}; identity unverified ·{' '}
                {data.intake.reviewStatus === 'pending'
                  ? 'Awaiting doctor review — not chart facts'
                  : 'Doctor reviewed staging — verify relevance to this visit'}
                .
              </p>
              {data.intake.vitals && (
                <p className="mt-2">
                  Submitted readings (not chart vitals): {intakeVitalsText(data.intake.vitals)} ·
                  measured {new Date(data.intake.vitals.measuredAt).toLocaleString('en-IN')}
                </p>
              )}
              <Link
                className="mt-1 block text-[var(--color-accent)] underline"
                href={`/app/patients/${clientId}#scribe-intake`}
              >
                Review full intake and provenance
              </Link>
            </div>
          )}
          <Link
            className="block text-sm text-[var(--color-accent)] underline"
            href={`/app/patients/${clientId}#scribe-reports`}
          >
            Review uploaded report dates and values in patient record
          </Link>
          {data.visits.length === 0 ? (
            <p className="text-sm">No signed medical encounters available.</p>
          ) : (
            data.visits.map((visit, index) => (
              <details
                key={visit.sessionId}
                open={index === 0}
                className="border-t border-[var(--color-line-soft)] pt-2"
              >
                <summary className="cursor-pointer text-sm font-medium">
                  {index === 0 ? 'Latest signed visit' : 'Earlier signed visit'} ·{' '}
                  {new Date(visit.encounterAt).toLocaleDateString('en-IN')}
                </summary>
                <div className="mt-2 space-y-2 text-sm">
                  <p>
                    <strong>Complaint: </strong>
                    {visit.complaint || 'Not documented'}
                  </p>
                  <p className="whitespace-pre-wrap">
                    <strong>Assessment: </strong>
                    {visit.assessment || 'Not documented'}
                  </p>
                  <p className="whitespace-pre-wrap">
                    <strong>Plan / pending items to verify: </strong>
                    {visit.plan || 'Not documented'}
                  </p>
                  <p>
                    <strong>Prescription at that visit (not a current medication list): </strong>
                    {visit.prescriptions.length
                      ? visit.prescriptions
                          .map((med) =>
                            [med.drug, med.dose, med.frequency, med.duration]
                              .filter(Boolean)
                              .join(' · '),
                          )
                          .join('; ')
                      : 'No confirmed prescription available'}
                  </p>
                  <Link
                    className="text-[var(--color-accent)] underline"
                    href={`/app/patients/${clientId}/encounters/${visit.sessionId}`}
                  >
                    Open source encounter
                  </Link>
                  <p className="text-xs text-[var(--color-ink-3)]">
                    Signed {new Date(visit.signedAt).toLocaleString('en-IN')}
                  </p>
                </div>
              </details>
            ))
          )}
        </>
      )}
    </section>
  );
}
