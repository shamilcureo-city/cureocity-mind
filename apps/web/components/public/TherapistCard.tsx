import Link from 'next/link';
import { Badge } from '../ui/Badge';
import { PublicAvatar } from './Avatar';
import type { DirectoryRow } from '@/lib/public-profile';

/** Marketing V1 — one directory result. Links by SLUG, never by id. */

function formatFee(inr: number | null): string {
  if (inr === null) return 'Fee on request';
  return `₹${inr.toLocaleString('en-IN')} / session`;
}

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  hi: 'Hindi',
  ml: 'Malayalam',
  ta: 'Tamil',
  te: 'Telugu',
  kn: 'Kannada',
  bn: 'Bengali',
  mr: 'Marathi',
  gu: 'Gujarati',
  pa: 'Punjabi',
};

export function languageName(code: string): string {
  return LANGUAGE_NAMES[code] ?? code.toUpperCase();
}

export function TherapistCard({ therapist }: { therapist: DirectoryRow }) {
  const location = [therapist.locationCity, therapist.locationProvince].filter(Boolean).join(', ');

  return (
    <article className="group relative flex h-full flex-col rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-6 transition-shadow hover:shadow-md">
      <div className="flex items-start gap-4">
        <PublicAvatar name={therapist.fullName} photoUrl={therapist.photoUrl} size={56} />
        <div className="min-w-0 flex-1">
          <h3 className="font-serif text-lg leading-tight">
            <Link
              href={`/therapists/${therapist.publicSlug}`}
              className="after:absolute after:inset-0 hover:underline"
            >
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

      <dl className="mt-auto space-y-1 pt-5 text-sm text-[var(--color-ink-2)]">
        {location && <div>{location}</div>}
        {therapist.languages.length > 0 && (
          <div>{therapist.languages.map(languageName).join(' · ')}</div>
        )}
        <div className="flex items-center justify-between">
          <span>{formatFee(therapist.sessionFeeInr)}</span>
          {therapist.isAcceptingNewClients ? (
            <span className="text-xs font-medium text-[var(--color-accent)]">
              Accepting clients
            </span>
          ) : (
            <span className="text-xs text-[var(--color-ink-3)]">Waitlist only</span>
          )}
        </div>
      </dl>
    </article>
  );
}
