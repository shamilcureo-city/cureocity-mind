import { Container } from '@/components/ui/Container';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { IntakeActions } from '@/components/dashboard/IntakeActions';
import { fetchAllIntakes } from '@/lib/dashboard';

export const dynamic = 'force-dynamic';

export default async function IntakesPage() {
  const rows = await fetchAllIntakes();
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
          Inbox
        </p>
        <h1 className="mt-2 font-serif text-4xl">New intakes</h1>
        <p className="mt-1 text-[var(--color-ink-2)]">
          People the matching team has flagged for you, plus the open queue. Claim what fits your
          practice — release the rest.
        </p>
      </header>

      {rows.length === 0 ? (
        <Card className="mt-10 p-8 text-center">
          <p className="font-serif text-2xl">All caught up.</p>
          <p className="mt-2 text-sm text-[var(--color-ink-2)]">
            The intake queue is empty. Nicely done.
          </p>
        </Card>
      ) : (
        <ul className="mt-10 space-y-3">
          {rows.map((i) => (
            <li key={i.id}>
              <Card className="p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-3">
                      <p className="font-medium">{i.patientName}</p>
                      <Badge tone={urgencyTone(i.urgency)}>{urgencyLabel(i.urgency)}</Badge>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {i.concerns.map((c) => (
                        <Badge key={c}>{c}</Badge>
                      ))}
                    </div>
                    {(i.preferredLanguage || i.preferredModality) && (
                      <p className="mt-3 text-sm text-[var(--color-ink-2)]">
                        Prefers{' '}
                        {[i.preferredLanguage, i.preferredModality].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </div>
                  <span className="text-xs text-[var(--color-ink-3)]">
                    {new Date(i.createdAt).toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </span>
                </div>
                <IntakeActions intakeId={i.id} />
              </Card>
            </li>
          ))}
        </ul>
      )}
    </Container>
  );
}

function urgencyTone(u: 'LOW' | 'MEDIUM' | 'HIGH'): 'default' | 'accent' | 'warn' {
  return u === 'HIGH' ? 'warn' : u === 'MEDIUM' ? 'accent' : 'default';
}

function urgencyLabel(u: 'LOW' | 'MEDIUM' | 'HIGH'): string {
  return u === 'HIGH' ? 'Urgent' : u === 'MEDIUM' ? 'This week' : 'Flexible';
}
