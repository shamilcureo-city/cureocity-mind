import { Badge } from '../ui/Badge';
import { WorkflowSection } from './WorkflowSection';

interface ClientPanelData {
  id: string;
  fullName: string;
  contactPhone: string;
  contactEmail: string | null;
  dateOfBirth: Date | null;
  presentingConcerns: string | null;
  preferredModality: string | null;
  pastSessionCount: number;
  lastSessionAt: Date | null;
}

function calcAge(dob: Date | null): number | null {
  if (!dob) return null;
  const ms = Date.now() - dob.getTime();
  return Math.floor(ms / (365.25 * 24 * 60 * 60 * 1000));
}

export function ClientTab({ data }: { data: ClientPanelData }) {
  const age = calcAge(data.dateOfBirth);
  return (
    <div className="rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-serif text-2xl">{data.fullName}</h2>
          <p className="mt-1 text-sm text-[var(--color-ink-2)]">
            {age !== null ? `${age} years` : 'Age not recorded'}
          </p>
        </div>
        {data.preferredModality && <Badge tone="muted">{data.preferredModality}</Badge>}
      </header>

      <dl className="mt-6 grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
        <Field label="Phone" value={data.contactPhone} />
        <Field label="Email" value={data.contactEmail ?? '—'} />
        <Field
          label="Past sessions"
          value={
            data.pastSessionCount === 0
              ? 'First session'
              : `${data.pastSessionCount} session${data.pastSessionCount === 1 ? '' : 's'}`
          }
        />
        <Field
          label="Last session"
          value={
            data.lastSessionAt
              ? data.lastSessionAt.toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })
              : '—'
          }
        />
      </dl>

      <section className="mt-6">
        <h3 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
          Presenting concerns
        </h3>
        <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-[var(--color-ink)]">
          {data.presentingConcerns?.trim() ||
            'No presenting concerns recorded yet. Add them from the Clients tab.'}
        </p>
      </section>

      <div className="mt-6 border-t border-[var(--color-line-soft)] pt-6">
        <WorkflowSection clientId={data.id} />
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">{label}</dt>
      <dd className="mt-1 text-[var(--color-ink)]">{value}</dd>
    </div>
  );
}
