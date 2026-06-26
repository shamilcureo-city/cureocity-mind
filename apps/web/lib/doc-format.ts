/**
 * Shared helpers for generated documents (PDF exports + letters).
 *
 * Extracted in the S58–S69 follow-up review: `ageFromDob`, the filename
 * slug, and the date formatter were each copy-pasted across the case-file,
 * discharge-summary and letter routes/components. One home keeps them in
 * sync — and, critically, makes every generated date format in IST.
 *
 * Cureocity is India-only but Vercel's clock is UTC; a bare
 * `toLocaleDateString('en-GB')` on the server prints the wrong CALENDAR
 * DAY for any timestamp near IST midnight. These helpers pin
 * `timeZone: 'Asia/Kolkata'` so a clinical/legal document never shows a
 * date that's a day off.
 */

const PDF_TZ = 'Asia/Kolkata';

/** Whole years between a date of birth and now (clamped to a sane 0–149). */
export function ageFromDob(dob: Date | null): number | null {
  if (!dob) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age -= 1;
  return age >= 0 && age < 150 ? age : null;
}

/**
 * A filesystem-safe slug for a download filename: lowercased, non-alnum
 * runs collapsed to single hyphens, trimmed. `maxLen` truncates the result
 * (used for long letter subjects).
 */
export function safeFileSlug(value: string, maxLen?: number): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return maxLen !== undefined ? slug.slice(0, maxLen) : slug;
}

/** IST date for a generated document, e.g. "27 Jun 2026". */
export function formatPdfDate(value: string | Date, opts: Intl.DateTimeFormatOptions = {}): string {
  return new Date(value).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: PDF_TZ,
    ...opts,
  });
}

/** IST date + time for a "prepared / generated on" footer line. */
export function formatPdfDateTime(value: string | Date): string {
  return new Date(value).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: PDF_TZ,
  });
}
