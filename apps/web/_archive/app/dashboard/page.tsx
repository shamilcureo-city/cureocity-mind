import Link from 'next/link';
import { Container } from '@/components/ui/Container';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { fetchDashboardSnapshot } from '@/lib/dashboard';

export const dynamic = 'force-dynamic';

export default async function DashboardHomePage() {
  const snap = await fetchDashboardSnapshot();
  if (!snap) {
    return (
      <Container className="py-16">
        <p className="text-sm text-[var(--color-ink-3)]">
          No therapist profile is linked to this account yet.
        </p>
      </Container>
    );
  }

  const firstName = snap.therapistName
    .split(' ')
    .slice(-1)[0]!
    .replace(/[^A-Za-z]/g, '');

  return (
    <Container className="py-10 sm:py-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
            {greeting()}
          </p>
          <h1 className="mt-2 font-serif text-4xl leading-tight">
            Good to see you, Dr. {firstName}.
          </h1>
          <p className="mt-1 text-[var(--color-ink-2)]">Here is what is waiting for you today.</p>
        </div>
        <Link
          href="/therapists"
          className="text-sm text-[var(--color-ink-2)] underline hover:text-[var(--color-ink)]"
        >
          View public profile
        </Link>
      </header>

      <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Active clients" value={snap.counts.activeClients} />
        <Stat label="Pending bookings" value={snap.counts.pendingBookings} accent />
        <Stat label="New intake matches" value={snap.counts.newIntakes} />
        <Stat label="Upcoming sessions" value={snap.counts.upcomingSessions} />
      </section>

      <section className="mt-10 grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <Header2 title="Booking requests" href="/dashboard/bookings" />
          {snap.pendingBookings.length === 0 ? (
            <Empty text="No pending booking requests. Nice — caught up." />
          ) : (
            <ul className="mt-5 divide-y divide-[var(--color-line-soft)]">
              {snap.pendingBookings.slice(0, 4).map((b) => (
                <li key={b.id} className="py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{b.patientName}</p>
                      <p className="mt-0.5 text-sm text-[var(--color-ink-2)]">
                        Wants {formatWhen(b.preferredAt)}
                      </p>
                      {b.message && (
                        <p className="mt-2 line-clamp-2 text-sm text-[var(--color-ink-3)]">
                          “{b.message}”
                        </p>
                      )}
                    </div>
                    <Badge tone="warn">Pending</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-6">
          <Header2 title="New intakes to review" href="/dashboard/intakes" />
          {snap.newIntakes.length === 0 ? (
            <Empty text="Nothing new in the intake queue right now." />
          ) : (
            <ul className="mt-5 divide-y divide-[var(--color-line-soft)]">
              {snap.newIntakes.slice(0, 4).map((i) => (
                <li key={i.id} className="py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">{i.patientName}</p>
                      <p className="mt-0.5 line-clamp-1 text-sm text-[var(--color-ink-2)]">
                        {i.concerns.slice(0, 3).join(' · ')}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {i.preferredLanguage && <Badge>{i.preferredLanguage}</Badge>}
                        {i.preferredModality && <Badge>{i.preferredModality}</Badge>}
                      </div>
                    </div>
                    <Badge tone={urgencyTone(i.urgency)}>{urgencyLabel(i.urgency)}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <section className="mt-10">
        <Card className="p-6">
          <Header2 title="Recent clients" href="/dashboard/clients" />
          {snap.recentClients.length === 0 ? (
            <Empty text="No clients yet. Accept a booking or convert an intake to add your first." />
          ) : (
            <ul className="mt-5 divide-y divide-[var(--color-line-soft)]">
              {snap.recentClients.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-4">
                  <div className="min-w-0">
                    <Link
                      href={`/dashboard/clients/${c.id}`}
                      className="font-medium hover:underline"
                    >
                      {c.fullName}
                    </Link>
                    {c.presentingConcerns && (
                      <p className="mt-0.5 line-clamp-1 text-sm text-[var(--color-ink-2)]">
                        {c.presentingConcerns}
                      </p>
                    )}
                  </div>
                  <Badge>{c.status.toLowerCase()}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </Container>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div
      className={`rounded-2xl border p-5 ${
        accent
          ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
          : 'border-[var(--color-line)] bg-white'
      }`}
    >
      <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-ink-3)]">
        {label}
      </p>
      <p className="mt-2 font-serif text-3xl">{value}</p>
    </div>
  );
}

function Header2({ title, href }: { title: string; href: string }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="font-serif text-xl">{title}</h2>
      <Link href={href} className="text-sm text-[var(--color-accent)] hover:underline">
        See all →
      </Link>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <p className="mt-6 rounded-xl bg-[var(--color-surface-soft)] p-4 text-sm text-[var(--color-ink-3)]">
      {text}
    </p>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function urgencyTone(u: 'LOW' | 'MEDIUM' | 'HIGH'): 'default' | 'warn' | 'accent' {
  if (u === 'HIGH') return 'warn';
  if (u === 'MEDIUM') return 'accent';
  return 'default';
}

function urgencyLabel(u: 'LOW' | 'MEDIUM' | 'HIGH'): string {
  return u === 'HIGH' ? 'Urgent' : u === 'MEDIUM' ? 'This week' : 'Flexible';
}
