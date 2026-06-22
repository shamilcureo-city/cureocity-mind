'use client';

import type { TherapyNoteV1 } from '@cureocity/contracts';

type Severity = TherapyNoteV1['riskFlags']['severity'];

const HIGH_SET: ReadonlySet<Severity> = new Set(['high', 'critical']);

const PALETTE: Record<Severity, { ring: string; bg: string; ink: string; pill: string }> = {
  none: { ring: '', bg: '', ink: '', pill: '' },
  low: { ring: '', bg: '', ink: '', pill: '' },
  medium: { ring: '', bg: '', ink: '', pill: '' },
  high: {
    ring: 'border-[#c8651f]',
    bg: 'bg-[#fbe9dc]',
    ink: 'text-[#8b3a0f]',
    pill: 'bg-[#c8651f] text-white',
  },
  critical: {
    ring: 'border-[#9f1f1f]',
    bg: 'bg-[#fbe1de]',
    ink: 'text-[#7f1010]',
    pill: 'bg-[#9f1f1f] text-white',
  },
};

interface Props {
  riskFlags: TherapyNoteV1['riskFlags'];
}

export function RiskBanner({ riskFlags }: Props) {
  if (!HIGH_SET.has(riskFlags.severity)) return null;
  const palette = PALETTE[riskFlags.severity];
  return (
    <aside
      role="alert"
      className={`mb-6 rounded-2xl border ${palette.ring} ${palette.bg} ${palette.ink} p-5`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${palette.pill}`}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path
                d="M12 9v4M12 17h.01M10.3 3.86 1.82 18a2 2 0 0 0 1.73 3h16.9a2 2 0 0 0 1.73-3L13.7 3.86a2 2 0 0 0-3.4 0z"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <div>
            <p className="font-serif text-lg">Safety flag — {riskFlags.severity.toUpperCase()}</p>
            <p className="mt-1 text-sm">
              Something in this session needs your clinical attention. Please don't sign off until
              you have looked into it.
            </p>
          </div>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider ${palette.pill}`}
        >
          {riskFlags.severity}
        </span>
      </div>

      {riskFlags.indicators.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wider">Indicators</p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {riskFlags.indicators.map((i) => (
              <li key={i} className="rounded-full bg-white/60 px-2.5 py-1 text-xs font-medium">
                {i}
              </li>
            ))}
          </ul>
        </div>
      )}

      {riskFlags.details && (
        <p className="mt-3 whitespace-pre-line text-sm leading-relaxed">{riskFlags.details}</p>
      )}

      <div className="mt-4 flex flex-wrap gap-2 text-xs">
        <a
          href="#crisis"
          className="rounded-full bg-white/70 px-3 py-1 font-medium underline-offset-2 hover:underline"
        >
          Crisis helplines
        </a>
        <span className="rounded-full bg-white/40 px-3 py-1">
          Saved to this client's safety record
        </span>
      </div>
    </aside>
  );
}
