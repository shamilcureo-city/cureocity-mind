'use client';

import { useEffect, useState } from 'react';
import {
  ChronicTrajectorySchema,
  type ChronicMeasureTrajectory,
  type ControlStatus,
} from '@cureocity/contracts';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';

/**
 * Sprint DS7 — the 3-second context flash before a consult starts.
 *
 * Surfaces what the doctor should hold in mind for THIS patient — chronic
 * trends (real, from /chronic), and what the copilot will be watching —
 * then auto-advances into listening. Skippable, and a big "Start now"
 * gives the mic gesture on the first patient (browsers require one until
 * permission sticks; patients 2..N auto-advance zero-click). See
 * docs/DOCTOR_SCRIBE_V2_SPRINTS.md DS7.
 */
const COUNTDOWN_SECONDS = 3;

export function ContextFlash({
  clientId,
  patientName,
  age,
  specialty,
  onDone,
}: {
  clientId: string;
  patientName: string;
  age: number | null;
  specialty?: string | null;
  onDone: () => void;
}) {
  const [measures, setMeasures] = useState<ChronicMeasureTrajectory[]>([]);
  const [left, setLeft] = useState(COUNTDOWN_SECONDS);

  // Pull the chronic trajectory so the doctor sees control/trend at a glance.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/v1/clients/${clientId}/chronic`);
        if (!res.ok) return;
        const parsed = ChronicTrajectorySchema.safeParse(await res.json());
        if (!cancelled && parsed.success) {
          setMeasures(parsed.data.measures.filter((m) => m.latest));
        }
      } catch {
        /* best-effort — the flash still shows identity + what's watched */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  // Auto-advance countdown.
  useEffect(() => {
    if (left <= 0) {
      onDone();
      return;
    }
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [left, onDone]);

  return (
    <Card className="mx-auto max-w-2xl overflow-hidden p-0">
      <div className="flex items-center justify-between gap-3 bg-[var(--color-accent-soft)] px-6 py-3">
        <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-accent)]">
          {specialty ? `${specialty} · ` : ''}Getting ready
        </p>
        <span className="grid h-7 w-7 place-items-center rounded-full bg-white text-sm font-bold tabular-nums text-[var(--color-accent)]">
          {left}
        </span>
      </div>

      <div className="space-y-5 px-6 py-6">
        <div>
          <h2 className="font-serif text-2xl">
            {patientName}
            {age != null && <span className="font-normal text-[var(--color-ink-3)]"> · {age}</span>}
          </h2>
        </div>

        <div>
          <SectionLabel>Chronic trends</SectionLabel>
          {measures.length === 0 ? (
            <p className="mt-1.5 text-sm text-[var(--color-ink-3)]">
              No chronic readings on file yet.
            </p>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              {measures.map((m) => (
                <TrendChip key={m.measure} m={m} />
              ))}
            </div>
          )}
        </div>

        <div>
          <SectionLabel>Copilot is watching</SectionLabel>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {['Red flags', 'Drug interactions', 'Missing questions', 'ICD-10 coding'].map((w) => (
              <span
                key={w}
                className="rounded-full border border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] px-2.5 py-1 text-xs text-[var(--color-ink-2)]"
              >
                {w}
              </span>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3 pt-1">
          <Button onClick={onDone}>● Start recording now</Button>
          <button
            type="button"
            onClick={onDone}
            className="text-sm font-medium text-[var(--color-ink-3)] hover:text-[var(--color-ink)]"
          >
            Skip
          </button>
        </div>
      </div>
    </Card>
  );
}

const CONTROL_STYLE: Record<ControlStatus, { bg: string; fg: string }> = {
  controlled: { bg: 'var(--color-accent-soft)', fg: 'var(--color-accent)' },
  borderline: { bg: 'var(--color-warn-soft)', fg: 'var(--color-warn)' },
  uncontrolled: { bg: 'var(--color-crit-soft,#fbe4e0)', fg: '#c0392b' },
};

function TrendChip({ m }: { m: ChronicMeasureTrajectory }) {
  const glyph = m.trend === 'improving' ? '↓' : m.trend === 'worsening' ? '↑' : '→';
  const style = m.control
    ? CONTROL_STYLE[m.control]
    : { bg: 'var(--color-surface-soft)', fg: 'var(--color-ink-2)' };
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm"
      style={{ background: style.bg, color: style.fg }}
      title={m.summary ?? undefined}
    >
      <span className="text-[11px] font-bold uppercase tracking-wide opacity-80">{m.label}</span>
      <span className="font-semibold">
        {m.latest?.display}
        {m.unit ? ` ${m.unit}` : ''}
      </span>
      <span className="font-bold">{glyph}</span>
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--color-ink-3)]">
      {children}
    </span>
  );
}
