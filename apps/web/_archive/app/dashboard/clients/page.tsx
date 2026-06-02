import Link from 'next/link';
import { Container } from '@/components/ui/Container';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/therapist/Avatar';
import { fetchClients } from '@/lib/dashboard';

export const dynamic = 'force-dynamic';

export default async function ClientsPage() {
  const rows = await fetchClients();
  if (!rows) {
    return (
      <Container className="py-16">
        <p className="text-sm text-[var(--color-ink-3)]">No therapist profile is linked.</p>
      </Container>
    );
  }

  return (
    <Container className="py-10">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
          Roster
        </p>
        <h1 className="mt-2 font-serif text-4xl">Your clients</h1>
        <p className="mt-1 text-[var(--color-ink-2)]">
          Active and historical clients. Tap a row to see sessions, notes, and contact info.
        </p>
      </header>

      {rows.length === 0 ? (
        <Card className="mt-10 p-8 text-center">
          <p className="font-serif text-2xl">No clients yet.</p>
          <p className="mt-2 text-sm text-[var(--color-ink-2)]">
            Accept a booking request or convert an intake to add your first client.
          </p>
          <Link
            href="/dashboard/bookings"
            className="mt-4 inline-block text-sm font-medium text-[var(--color-accent)] underline"
          >
            Go to booking requests →
          </Link>
        </Card>
      ) : (
        <Card className="mt-10 overflow-hidden">
          <ul className="divide-y divide-[var(--color-line-soft)]">
            {rows.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/dashboard/clients/${c.id}`}
                  className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-[var(--color-surface-soft)]"
                >
                  <Avatar name={c.fullName} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium">{c.fullName}</p>
                      <Badge tone={c.status === 'ACTIVE' ? 'accent' : 'muted'}>
                        {c.status.toLowerCase()}
                      </Badge>
                    </div>
                    <p className="mt-0.5 truncate text-sm text-[var(--color-ink-2)]">
                      {c.presentingConcerns ?? 'No presenting concerns recorded yet'}
                    </p>
                  </div>
                  <div className="text-right text-xs text-[var(--color-ink-3)]">
                    {c.lastSessionAt
                      ? `Last session ${formatDate(c.lastSessionAt)}`
                      : `Onboarded ${formatDate(c.createdAt)}`}
                    {c.preferredModality && (
                      <p className="mt-1 text-[var(--color-ink-2)]">{c.preferredModality}</p>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Container>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
