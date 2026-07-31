/**
 * Indian phone normalisation, shared by every surface that accepts one.
 *
 * The stored form is canonical — `+91` followed by exactly 10 digits — because
 * WhatsApp and SMS routing depend on it (`IndianPhoneSchema` enforces it at the
 * API boundary). But nobody types it that way: they type "+91 98765 43210",
 * "98765 43210", "091-98765-43210", or paste it out of a contact card.
 *
 * Rejecting those is a bad trade. The therapist has the number written on a
 * form in front of them; making them reformat it — and, until this existed,
 * telling them only "Validation failed" when they got it wrong — is friction
 * for nothing. This normalises the common shapes and leaves anything genuinely
 * ambiguous alone, so the server still has the final say.
 */

/** The canonical shape the API accepts. */
export const INDIAN_PHONE_RE = /^\+91\d{10}$/;

/**
 * Best-effort canonicalisation. Returns the input stripped of separators when
 * no confident interpretation exists, so the caller still fails validation
 * loudly rather than silently sending something wrong.
 *
 *   "+91 98765 43210"  → "+919876543210"
 *   "98765 43210"      → "+919876543210"   (bare 10-digit mobile)
 *   "0 9876543210"     → "+919876543210"   (trunk prefix)
 *   "919876543210"     → "+919876543210"   (country code, no plus)
 *   "+1 555 0100"      → "+15550100"       (left alone — not ours to guess)
 */
export function normaliseIndianPhone(raw: string): string {
  const stripped = raw.replace(/[\s\-().]/g, '');
  if (stripped === '') return '';

  // Already canonical, or some other country's number — don't touch it.
  if (INDIAN_PHONE_RE.test(stripped)) return stripped;
  if (stripped.startsWith('+') && !stripped.startsWith('+91')) return stripped;

  const digits = stripped.replace(/^\+/, '');

  // +91 with the wrong digit count stays as typed: it is a real mistake and
  // the therapist should see it, not have it silently reshaped.
  if (stripped.startsWith('+91')) return stripped;

  // 9876543210 — the way an Indian number is normally written.
  if (/^\d{10}$/.test(digits)) return `+91${digits}`;
  // 919876543210 — country code without the plus.
  if (/^91\d{10}$/.test(digits)) return `+${digits}`;
  // 09876543210 — domestic trunk prefix.
  if (/^0\d{10}$/.test(digits)) return `+91${digits.slice(1)}`;

  return stripped;
}

/** True when the value will satisfy `IndianPhoneSchema` after normalisation. */
export function isValidIndianPhone(raw: string): boolean {
  return INDIAN_PHONE_RE.test(normaliseIndianPhone(raw));
}
