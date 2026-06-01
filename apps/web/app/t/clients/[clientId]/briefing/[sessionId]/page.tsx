import { notFound } from 'next/navigation';
import Link from 'next/link';
import { fetchClientBriefing, fetchLastSignedNote } from '@/lib/api-server';

interface PageProps {
  params: Promise<{ clientId: string; sessionId: string }>;
}

/**
 * Pre-session briefing dossier (React Server Component). Fetches client
 * + consents + recent sessions directly from Prisma, plus the most
 * recent signed therapy note (when present) so the therapist can carry
 * context into the next session.
 */
export default async function BriefingPage({ params }: PageProps) {
  const { clientId, sessionId } = await params;

  const [briefing, lastNote] = await Promise.all([
    fetchClientBriefing(clientId),
    fetchLastSignedNote(clientId),
  ]);
  if (!briefing) notFound();

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <Link href={`/t/clients/${clientId}`} className="text-xs underline">
        ← Back to client
      </Link>

      <header className="mt-3 mb-8">
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
        {lastNote === null ? (
          <p className="text-sm text-[var(--color-slate-500)]">
            No signed note yet — appears here once the scribe pipeline runs and the clinician signs
            off.
          </p>
        ) : (
          <div className="space-y-4 rounded-lg border border-[var(--color-slate-200)] bg-white p-6 text-sm">
            <p className="text-xs text-[var(--color-slate-500)]">
              Signed {new Date(lastNote.signedAt).toLocaleString()} · session{' '}
              <code>{lastNote.sessionId}</code>
            </p>
            {(['subjective', 'objective', 'assessment', 'plan'] as const).map((field) => (
              <div key={field}>
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-slate-500)]">
                  {field}
                </p>
                <p className="mt-1 whitespace-pre-wrap">{lastNote.content[field]}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
