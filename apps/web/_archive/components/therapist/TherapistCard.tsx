import Link from 'next/link';
import { Avatar } from './Avatar';
import { Badge } from '../ui/Badge';

export interface TherapistSummary {
  id: string;
  fullName: string;
  headline: string | null;
  specialties: string[];
  languages: string[];
  locationCity: string | null;
  locationProvince: string | null;
  sessionFeeInr: number | null;
  yearsOfExperience: number | null;
  isAcceptingNewClients: boolean;
}

function formatFee(inr: number | null): string {
  if (inr === null) return 'Sliding scale';
  return `₹${inr.toLocaleString('en-IN')} / session`;
}

export function TherapistCard({ therapist }: { therapist: TherapistSummary }) {
  const location = [therapist.locationCity, therapist.locationProvince].filter(Boolean).join(', ');

  return (
    <article className="group relative flex h-full flex-col rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-6 transition-colors hover:border-[var(--color-ink-3)]">
      <div className="flex items-start gap-4">
        <Avatar name={therapist.fullName} size={56} />
        <div className="min-w-0 flex-1">
          <h3 className="font-serif text-lg leading-tight">
            <Link href={`/therapists/${therapist.id}`} className="hover:underline">
              {therapist.fullName}
            </Link>
          </h3>
          {therapist.headline && (
            <p className="mt-1 line-clamp-2 text-sm text-[var(--color-ink-2)]">
              {therapist.headline}
            </p>
          )}
        </div>
      </div>

      {therapist.specialties.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {therapist.specialties.slice(0, 3).map((s) => (
            <Badge key={s} tone="accent">
              {s}
            </Badge>
          ))}
          {therapist.specialties.length > 3 && (
            <Badge tone="muted">+{therapist.specialties.length - 3}</Badge>
          )}
        </div>
      )}

      <dl className="mt-5 space-y-1.5 text-sm text-[var(--color-ink-2)]">
        {location && (
          <div className="flex items-center gap-2">
            <span aria-hidden>·</span>
            <span>{location}</span>
          </div>
        )}
        {therapist.languages.length > 0 && (
          <div className="flex items-center gap-2">
            <span aria-hidden>·</span>
            <span>{therapist.languages.join(', ')}</span>
          </div>
        )}
        {therapist.yearsOfExperience !== null && (
          <div className="flex items-center gap-2">
            <span aria-hidden>·</span>
            <span>{therapist.yearsOfExperience}+ years of experience</span>
          </div>
        )}
      </dl>

      <div className="mt-5 flex items-center justify-between border-t border-[var(--color-line-soft)] pt-4">
        <span className="text-sm font-medium text-[var(--color-ink)]">
          {formatFee(therapist.sessionFeeInr)}
        </span>
        <Link
          href={`/therapists/${therapist.id}`}
          className="text-sm font-medium text-[var(--color-accent)] hover:underline"
        >
          View profile →
        </Link>
      </div>

      {!therapist.isAcceptingNewClients && (
        <div className="absolute right-4 top-4 rounded-full bg-[var(--color-warn-soft)] px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--color-warn)]">
          Waitlist
        </div>
      )}
    </article>
  );
}
