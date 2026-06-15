/**
 * Sprint 56 (Lever 3a) — patient-artefact watermark.
 *
 * Patient-facing surfaces (portal + share email) carry a
 * "Powered by Cureocity Mind" footer with a UTM-tagged signup link, so
 * every artefact a paying therapist sends becomes a brand touch to
 * prospective therapists in the patient's network. The footer is on by
 * default; a future per-clinic suppress switch (Premium tier perk) is
 * intentionally NOT shipped here — no Premium customers exist yet.
 */
const DEFAULT_MARKETING_URL = 'https://cureocitymind.com';

/** Resolve the marketing/landing site URL, env-overridable. */
export function marketingBaseUrl(): string {
  return process.env['NEXT_PUBLIC_MARKETING_URL'] ?? DEFAULT_MARKETING_URL;
}

export interface WatermarkLinkArgs {
  /// One of 'patient_portal' | 'share_email' | 'pdf' so the funnel
  /// dashboard can attribute signups to the surface that sourced them.
  source: 'patient_portal' | 'share_email';
  /// The artefact type that carried the footer (SIGNED_NOTE,
  /// PROGRESS_REPORT, etc.) — populates utm_campaign so we can rank
  /// which artefact drives the most signups.
  campaign?: string;
}

/**
 * Build a UTM-tagged signup link. The marketing site is expected to
 * forward these params to /api/v1/auth/session via the signup form, so
 * they land on `Psychologist.acquisitionUtm` (see CreateSessionInput).
 */
export function watermarkUrl({ source, campaign }: WatermarkLinkArgs): string {
  const params = new URLSearchParams();
  params.set('utm_source', source);
  params.set('utm_medium', 'patient_share');
  if (campaign) params.set('utm_campaign', campaign);
  return `${marketingBaseUrl()}/?${params.toString()}`;
}

export const WATERMARK_TAGLINE =
  'Powered by Cureocity Mind — the clinical co-pilot for Indian therapists.';
