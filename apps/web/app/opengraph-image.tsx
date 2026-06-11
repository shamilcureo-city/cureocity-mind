import { ImageResponse } from 'next/og';

/**
 * Sprint 36 — Open Graph / link-preview image for the marketing page.
 *
 * Auto-wired by Next 15 file convention: this generates `og:image` (and
 * is reused for Twitter) at 1200×630. The landing page travels through
 * WhatsApp groups, where the preview card is the first impression.
 *
 * Deliberately uses the built-in system font rather than fetching
 * Fraunces at runtime — a network fetch here would make preview
 * generation flaky. Layout + brand colour carry it.
 */

export const runtime = 'nodejs';
export const alt = 'Cureocity Mind — the clinical co-pilot for Indian therapists';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  const accent = '#2d5f4d';
  const cream = '#faf7f2';
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: accent,
          padding: '72px 80px',
          color: cream,
          fontFamily: 'sans-serif',
        }}
      >
        {/* Soft glow accents */}
        <div
          style={{
            position: 'absolute',
            top: -160,
            right: -120,
            width: 520,
            height: 520,
            borderRadius: 9999,
            background: 'rgba(158,197,178,0.25)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: -200,
            left: -100,
            width: 460,
            height: 460,
            borderRadius: 9999,
            background: 'rgba(234,217,188,0.16)',
          }}
        />

        {/* Wordmark */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              background: cream,
              color: accent,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 26,
              fontWeight: 700,
            }}
          >
            cm
          </div>
          <div style={{ fontSize: 30, fontWeight: 600, letterSpacing: -0.5 }}>Cureocity Mind</div>
        </div>

        {/* Headline */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              fontSize: 76,
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: -2,
            }}
          >
            <span>Hold the session.</span>
            <span>The paperwork writes itself.</span>
          </div>
          <div style={{ fontSize: 30, color: 'rgba(250,247,242,0.82)', maxWidth: 900 }}>
            The clinical co-pilot for Indian psychotherapists — notes, briefs, and outcomes in
            the languages your clients actually speak.
          </div>
        </div>

        {/* Language row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 26, fontSize: 30, color: 'rgba(250,247,242,0.9)' }}>
          {['English', 'हिन्दी', 'മലയാളം', 'தமிழ்', 'বাংলা'].map((l, i) => (
            <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 26 }}>
              {i > 0 && <span style={{ color: 'rgba(250,247,242,0.4)' }}>·</span>}
              <span>{l}</span>
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
