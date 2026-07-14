'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { CareGiftButton } from './CareGiftButton';
import { CareShareButton } from './CareShareButton';

interface ProgressPayload {
  stage: 'GETTING_STARTED' | 'ASSESSMENT' | 'ACTIVE_WORK' | 'REVIEW_DUE';
  plan: { version: number; goals: Array<{ goal: string; status: string }> } | null;
  verdicts: Array<{ instrumentKey: string; verdict: string; plainWords: string }>;
  moodSeries: Array<{ at: string; mood: number; source: string }>;
  sessions: Array<{
    id: string;
    kind: string;
    status: string;
    topic: string | null;
    moodBefore: number | null;
    moodAfter: number | null;
    endedAt: string | null;
    report: { id: string } | null;
  }>;
}

const STAGES: Array<{ key: ProgressPayload['stage']; label: string }> = [
  { key: 'GETTING_STARTED', label: 'Intake' },
  { key: 'ASSESSMENT', label: 'Plan' },
  { key: 'ACTIVE_WORK', label: 'Active work' },
  { key: 'REVIEW_DUE', label: 'Review' },
];

/** Progress (AC5, S7) — the user's own journey, measured honestly. Wide
 * two-column board on the web; single column on phones. */
export function CareProgress() {
  const [data, setData] = useState<ProgressPayload | null>(null);

  useEffect(() => {
    void fetch('/api/v1/care/progress')
      .then((r) => r.json())
      .then((d) => setData(d as ProgressPayload))
      .catch(() => undefined);
  }, []);

  if (!data) {
    return (
      <div className="mx-auto max-w-md px-5 py-10 text-sm text-[var(--color-ink-3)] md:max-w-4xl md:px-8">
        Loading…
      </div>
    );
  }

  const stageIdx = STAGES.findIndex((s) => s.key === data.stage);
  const moods = data.moodSeries.slice(-30);

  return (
    <div className="mx-auto w-full max-w-md px-5 py-6 pb-28 md:max-w-4xl md:px-8 md:py-10">
      <h1 className="font-serif text-2xl font-semibold md:text-3xl">Your progress</h1>

      <Card className="mt-4 p-4 md:mt-6 md:p-5">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
          Where you are
        </span>
        <div className="mt-2 flex gap-1">
          {STAGES.map((s, i) => (
            <div key={s.key} className="flex-1 text-center">
              <div
                className={`h-1.5 rounded ${i <= stageIdx ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-line-soft)]'}`}
              />
              <span
                className={`mt-1 block text-[10px] ${i === stageIdx ? 'font-bold text-[var(--color-accent)]' : 'text-[var(--color-ink-3)]'}`}
              >
                {s.label}
              </span>
            </div>
          ))}
        </div>
      </Card>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {data.verdicts.map((v) => (
          <Card key={v.instrumentKey} className="p-4 md:p-5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
                {v.instrumentKey}
              </span>
              <span
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                  v.verdict === 'reliable_improvement'
                    ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                    : v.verdict === 'deterioration'
                      ? 'bg-[var(--color-warn-soft)] text-[var(--color-warn)]'
                      : 'bg-[var(--color-surface-soft)] text-[var(--color-ink-3)]'
                }`}
              >
                {v.verdict.replaceAll('_', ' ')}
              </span>
            </div>
            <p className="mt-1.5 text-sm">{v.plainWords}</p>
          </Card>
        ))}

        {moods.length >= 2 ? (
          <Card className="p-4 md:p-5">
            <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
              Mood · recent
            </span>
            <svg viewBox="0 0 240 60" className="mt-2 w-full" aria-label="Mood trend">
              <line
                x1="0"
                y1="55"
                x2="240"
                y2="55"
                stroke="var(--color-line-soft)"
                strokeWidth="1"
              />
              <polyline
                fill="none"
                stroke="var(--color-accent)"
                strokeWidth="2.5"
                strokeLinecap="round"
                points={moods
                  .map(
                    (m, i) =>
                      `${(i / Math.max(1, moods.length - 1)) * 240},${52 - (m.mood / 10) * 44}`,
                  )
                  .join(' ')}
              />
            </svg>
          </Card>
        ) : null}
      </div>

      <Card className="mt-3 p-4 md:p-5">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
          Sessions
        </span>
        <div className="mt-1 divide-y divide-[var(--color-line-soft)]">
          {data.sessions.length === 0 ? (
            <p className="py-2 text-sm text-[var(--color-ink-3)]">No sessions yet.</p>
          ) : (
            data.sessions.map((s) => (
              <div key={s.id} className="flex items-center justify-between py-2 text-sm">
                <span>
                  {s.kind === 'INTAKE'
                    ? 'Intake'
                    : s.kind === 'REVIEW'
                      ? 'Review'
                      : (s.topic ?? 'Session')}
                  {s.endedAt ? (
                    <span className="ml-1 text-[11px] text-[var(--color-ink-3)]">
                      {new Date(s.endedAt).toLocaleDateString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                      })}
                    </span>
                  ) : null}
                </span>
                <span className="flex items-center gap-2">
                  {s.moodBefore !== null && s.moodAfter !== null ? (
                    <span
                      className={`font-semibold ${s.moodAfter > s.moodBefore ? 'text-[var(--color-accent)]' : 'text-[var(--color-ink-3)]'}`}
                    >
                      {s.moodBefore} → {s.moodAfter}
                    </span>
                  ) : null}
                  {s.report ? (
                    <Link
                      href={`/care/session/${s.id}/report`}
                      className="text-[var(--color-accent)]"
                    >
                      →
                    </Link>
                  ) : null}
                </span>
              </div>
            ))
          )}
        </div>
      </Card>

      {/* CG6 — the artefact loop: a pride-shaped milestone card (numbers
          only, server-built) + the gift. Never diagnosis words. */}
      <Card className="mt-3 p-4 md:p-5">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
          Proud of this?
        </span>
        <p className="mt-1 text-sm text-[var(--color-ink-2)]">
          Make a card that says you've been showing up — just the numbers, nothing personal, and you
          can take the link down any time.
        </p>
        <div className="mt-2">
          <CareShareButton kind="MILESTONE" label="Make my showing-up card" />
        </div>
        <p className="mt-3 text-[13px] text-[var(--color-ink-2)]">
          Someone come to mind lately? <CareGiftButton />
        </p>
      </Card>
    </div>
  );
}
