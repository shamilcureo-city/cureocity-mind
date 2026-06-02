import { Container } from '@/components/ui/Container';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { BookingActions } from '@/components/dashboard/BookingActions';
import { fetchAllBookings, type PendingBooking } from '@/lib/dashboard';

export const dynamic = 'force-dynamic';

export default async function BookingsPage() {
  const data = await fetchAllBookings();
  if (!data) {
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
          Inbox
        </p>
        <h1 className="mt-2 font-serif text-4xl">Booking requests</h1>
        <p className="mt-1 text-[var(--color-ink-2)]">
          People who asked for an introductory call. Reply within one business day to keep your
          response score high.
        </p>
      </header>

      <Section title="Pending" tone="warn" bookings={data.pending} actionable />
      <Section title="Accepted" tone="accent" bookings={data.accepted} />
      <Section title="Declined" tone="muted" bookings={data.declined} />
    </Container>
  );
}

function Section({
  title,
  tone,
  bookings,
  actionable,
}: {
  title: string;
  tone: 'warn' | 'accent' | 'muted';
  bookings: PendingBooking[];
  actionable?: boolean;
}) {
  return (
    <section className="mt-10">
      <h2 className="mb-3 flex items-center gap-3 font-serif text-2xl">
        {title}
        <Badge tone={tone}>{bookings.length}</Badge>
      </h2>
      {bookings.length === 0 ? (
        <Card className="p-6 text-sm text-[var(--color-ink-3)]">Nothing here right now.</Card>
      ) : (
        <ul className="space-y-3">
          {bookings.map((b) => (
            <li key={b.id}>
              <Card className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{b.patientName}</p>
                    <p className="mt-0.5 text-sm text-[var(--color-ink-2)]">
                      Wants {formatWhen(b.preferredAt)}
                    </p>
                    <p className="mt-1 text-xs text-[var(--color-ink-3)]">
                      Reachable at {b.patientEmail}
                    </p>
                    {b.message && (
                      <blockquote className="mt-3 border-l-2 border-[var(--color-line)] pl-3 text-sm leading-relaxed text-[var(--color-ink-2)]">
                        {b.message}
                      </blockquote>
                    )}
                  </div>
                  <span className="text-xs text-[var(--color-ink-3)]">
                    Received {timeAgo(b.createdAt)}
                  </span>
                </div>
                {actionable && <BookingActions bookingId={b.id} />}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
