import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Container } from '@/components/ui/Container';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/therapist/Avatar';
import { fetchClientDetail } from '@/lib/dashboard';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ClientDetailPage({ params }: PageProps) {
  const { id } = await params;
  const c = await fetchClientDetail(id);
  if (!c) notFound();

  return (
    <Container className="py-10">
      <Link
        href="/dashboard/clients"
        className="text-sm text-[var(--color-ink-3)] hover:text-[var(--color-ink)]"
      >
        ← Back to clients
      </Link>

      <header className="mt-6 flex items-start gap-5">
        <Avatar name={c.fullName} size={72} />
        <div>
          <h1 className="font-serif text-4xl">{c.fullName}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-[var(--color-ink-2)]">
            <Badge tone={c.status === 'ACTIVE' ? 'accent' : 'muted'}>{c.status.toLowerCase()}</Badge>
            <span>{c.contactPhone}</span>
            {c.contactEmail && (
              <>
                <span aria-hidden>·</span>
                <span>{c.contactEmail}</span>
              </>
            )}
            <span aria-hidden>·</span>
            <span>Onboarded {new Date(c.createdAt).toLocaleDateString()}</span>
          </p>
        </div>
      </header>

      <div className="mt-10 grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <section className="space-y-6">
          <Card className="p-6">
            <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-3)]">
              Presenting concerns
            </h2>
            <p className="mt-3 whitespace-pre-line text-[15px] leading-relaxed">
              {c.presentingConcerns ?? 'Not recorded yet.'}
            </p>
          </Card>

          <Card className="p-6">
            <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-3)]">
              Sessions
            </h2>
            {c.sessions.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--color-ink-3)]">
                No sessions scheduled yet.
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-[var(--color-line-soft)]">
                {c.sessions.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center justify-between gap-3 py-3 text-sm"
                  >
                    <div>
                      <p className="font-medium">{s.modality}</p>
                      <p className="mt-0.5 text-xs text-[var(--color-ink-3)]">
                        {new Date(s.scheduledAt).toLocaleString('en-IN', {
                          weekday: 'short',
                          day: 'numeric',
                          month: 'short',
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                    <Badge>{s.status.replace(/_/g, ' ').toLowerCase()}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>

        <aside className="space-y-6">
          <Card className="p-6">
            <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-3)]">
              At a glance
            </h2>
            <dl className="mt-4 space-y-3 text-sm">
              <Row label="Status" value={c.status.toLowerCase()} />
              <Row label="Preferred modality" value={c.preferredModality ?? '—'} />
              <Row
                label="Last session"
                value={
                  c.lastSessionAt
                    ? new Date(c.lastSessionAt).toLocaleDateString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                      })
                    : '—'
                }
              />
              <Row label="Sessions on record" value={String(c.sessions.length)} />
            </dl>
          </Card>
        </aside>
      </div>
    </Container>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-[var(--color-ink-3)]">{label}</dt>
      <dd className="text-right text-[var(--color-ink)]">{value}</dd>
    </div>
  );
}
