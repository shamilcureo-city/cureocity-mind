import { notFound } from 'next/navigation';
import type { ClientBriefing } from '@cureocity/contracts';
import { fetchPatientModel } from '@/lib/api-server';

interface PageProps {
  params: Promise<{ clientId: string; sessionId: string }>;
}

/**
 * Briefing dossier — React Server Component that fetches the full
 * patient briefing from patient-model-service for a given (clientId,
 * sessionId).
 *
 * NOTE: sessionId is in the route per the plan ("Briefing screen renders
 * all sections from patient-model-service via React Server Component").
 * We currently only display client + consents + most recent sessions
 * from the briefing payload; sessionId is captured for downstream PDF
 * + edit links in Sprint 7.
 */
export default async function BriefingPage({ params }: PageProps) {
  const { clientId, sessionId } = await params;

  let briefing: ClientBriefing | null = null;
  try {
    briefing = await fetchPatientModel<ClientBriefing>(`/clients/${clientId}/briefing`);
  } catch {
    notFound();
  }
  if (!briefing) notFound();

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <header className="mb-8">
        <p className="text-xs uppercase tracking-wide text-[var(--color-slate-500)]">
          Briefing for session {sessionId}
        </p>
        <h1 className="mt-1 text-3xl font-semibold text-[var(--color-navy-700)]">
          {briefing.client.fullName}
        </h1>
        <p className="mt-1 text-sm text-[var(--color-slate-500)]">
          {briefing.client.preferredModality ?? '—'} · since{' '}
          {new Date(briefing.client.createdAt).toLocaleDateString()}
        </p>
      </header>

      {briefing.client.presentingConcerns && (
        <section className="mb-8 rounded-lg border border-[var(--color-slate-200)] bg-white p-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-slate-500)]">
            Presenting concerns
          </h2>
          <p className="whitespace-pre-wrap text-sm">{briefing.client.presentingConcerns}</p>
        </section>
      )}

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--color-slate-500)]">
          Consents
        </h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {briefing.consents.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between rounded-md border border-[var(--color-slate-200)] bg-white px-4 py-2 text-sm"
            >
              <span>{c.scope.replace(/_/g, ' ').toLowerCase()}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  c.status === 'GRANTED'
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-amber-100 text-amber-800'
                }`}
              >
                {c.status.toLowerCase()}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--color-slate-500)]">
          Recent sessions
        </h2>
        {briefing.recentSessions.length === 0 ? (
          <p className="text-sm text-[var(--color-slate-500)]">No prior sessions yet.</p>
        ) : (
          <ul className="divide-y divide-[var(--color-slate-200)] rounded-lg border border-[var(--color-slate-200)] bg-white">
            {briefing.recentSessions.map((s) => (
              <li key={s.id} className="px-4 py-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{s.modality}</span>
                  <span className="text-[var(--color-slate-500)]">
                    {new Date(s.scheduledAt).toLocaleString()}
                  </span>
                </div>
                <span className="text-xs uppercase tracking-wide text-[var(--color-slate-500)]">
                  {s.status.replace(/_/g, ' ').toLowerCase()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--color-slate-500)]">
          Last signed note
        </h2>
        {briefing.lastNote === null ? (
          <p className="text-sm text-[var(--color-slate-500)]">
            No signed note yet — first note will appear here once the scribe pipeline runs and the
            clinician signs off (Sprint 7).
          </p>
        ) : (
          <p className="text-sm">(note rendered here in Sprint 7)</p>
        )}
      </section>
    </main>
  );
}
