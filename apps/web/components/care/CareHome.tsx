'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { CareInstrumentForm } from './CareInstrumentForm';
import { MoodDial } from './MoodDial';
import type { CareResource } from './SafetyStrip';

interface HomePayload {
  displayName: string;
  personaName: string;
  status: string;
  gate: { allowed: boolean; code: string; reason?: string };
  nextSession: {
    kind: 'INTAKE' | 'TREATMENT' | 'REVIEW';
    sessionNumber: number;
    capMin: number;
    modalityTrack: string | null;
  };
  sessionsThisWeek: number;
  weeklyCap: number;
  istHour: number;
  hasBaseline: boolean;
  needsCheckin: boolean;
  effectiveTier: string;
  availableCredits: number;
  trialUsed: boolean;
  suppressUpsell: boolean;
  nextUnlockAt: string | null;
  plan: {
    version: number;
    goals: Array<{ goal: string; status: string }>;
    modalityTrack: string;
  } | null;
  homework: string | null;
  streak: number;
  record: { weeks: number; totalSessions: number; totalCheckins: number } | null;
  welcomeBack: boolean;
  homeworkTickedToday: boolean;
  homeworkTicksThisWeek: number;
  checkinToday: boolean;
  lastReport: { careSessionId: string; kind: string; headline: string | null } | null;
  resources: CareResource[];
}

const TOPICS = ['Just talk', 'Stress', 'Sleep', 'One thing on my mind'];

/**
 * Home (AC2, S4) — one primary action, the case file user-side. On the
 * web it's a two-column board (session starter + a plan/homework/last
 * aside); on phones it collapses to the single calm column. The crisis
 * strip is chrome supplied by the (app) shell layout.
 */
export function CareHome() {
  const router = useRouter();
  const [data, setData] = useState<HomePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [topic, setTopic] = useState('Just talk');
  const [mood, setMood] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);
  /// Pre-review check-in (CG1): a REVIEW without a fresh score runs blind.
  /// Soft gate — the UI asks first; "skip" still allows the session.
  const [reviewCheckinDone, setReviewCheckinDone] = useState(false);
  const [baselineDismissed, setBaselineDismissed] = useState(true);

  useEffect(() => {
    // The one gentle home re-prompt for the starting line — permanently
    // dismissible, never nagged (localStorage survives sessions).
    setBaselineDismissed(localStorage.getItem('care-baseline-later') === '1');
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/care/home');
      if (!res.ok) throw new Error(`Home failed (${res.status})`);
      setData((await res.json()) as HomePayload);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => void load(), [load]);

  async function startSession(): Promise<void> {
    if (!data) return;
    setStarting(true);
    setError(null);
    try {
      // CG2 rupture-repair: a "not really" on the assessment resonance check
      // pre-fills the next session's topic so the persona opens by asking
      // what it missed. One-shot — consumed here.
      let effectiveTopic = topic;
      // CG5 — the consented /care/check handoff: the anonymous score rides
      // into the intake so the first session opens warm. One-shot.
      let intakeArrival: string | null = null;
      if (data.nextSession.kind === 'INTAKE') {
        try {
          const raw = sessionStorage.getItem('care-check-handoff');
          if (raw) {
            const h = JSON.parse(raw) as { instrument?: string; score?: number };
            if (typeof h.score === 'number') {
              intakeArrival = `Before signing up they took the anonymous 2-minute ${h.instrument ?? 'PHQ-9'} check and scored ${h.score}/27 — mention gently that you saw it, don't recite the number.`;
            }
            sessionStorage.removeItem('care-check-handoff');
          }
        } catch {
          /* private mode */
        }
      }
      if (data.nextSession.kind === 'TREATMENT') {
        try {
          const prefill = localStorage.getItem('care-topic-prefill');
          if (prefill) {
            effectiveTopic = prefill;
            localStorage.removeItem('care-topic-prefill');
          }
        } catch {
          /* private mode */
        }
      }
      const res = await fetch('/api/v1/care/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(mood !== null ? { moodBefore: mood } : {}),
          ...(data.nextSession.kind === 'TREATMENT' ? { topic: effectiveTopic } : {}),
          ...(intakeArrival ? { topic: intakeArrival } : {}),
        }),
      });
      const body = (await res.json()) as {
        sessionId?: string;
        startToken?: string;
        error?: string;
      };
      if (!res.ok || !body.sessionId || !body.startToken) {
        throw new Error(body.error ?? 'Could not start the session');
      }
      // Handover via sessionStorage — never in the URL, never logged.
      sessionStorage.setItem(`care-start-${body.sessionId}`, body.startToken);
      router.push(`/care/session/${body.sessionId}`);
    } catch (e) {
      setError((e as Error).message);
      setStarting(false);
    }
  }

  async function tickHomework(): Promise<void> {
    if (!data || data.homeworkTickedToday) return;
    setData({
      ...data,
      homeworkTickedToday: true,
      homeworkTicksThisWeek: data.homeworkTicksThisWeek + 1,
    });
    await fetch('/api/v1/care/homework/tick', { method: 'POST' }).catch(() => undefined);
  }

  async function submitCheckin(v: number): Promise<void> {
    setMood(v);
    if (data && !data.checkinToday) {
      await fetch('/api/v1/care/checkins', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mood: v }),
      }).catch(() => undefined);
      setData({ ...data, checkinToday: true });
    }
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-md px-5 py-10 text-sm text-[var(--color-ink-3)] md:max-w-5xl md:px-8">
        {error ?? 'Loading your space…'}
      </div>
    );
  }

  const n = data.nextSession;
  const sessionTitle =
    n.kind === 'INTAKE'
      ? "First session — let's understand what's going on"
      : n.kind === 'REVIEW'
        ? `Review session · with ${data.personaName}`
        : `Session ${n.sessionNumber} · with ${data.personaName}`;

  const sessionCard = (
    <Card className="p-4 md:p-6">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
          {sessionTitle}
        </span>
        <span className="rounded-full bg-[var(--color-accent-soft)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--color-accent)]">
          ~{n.capMin} min{n.modalityTrack ? ` · ${n.modalityTrack}` : ''}
        </span>
      </div>
      {data.gate.allowed && n.kind === 'REVIEW' && data.needsCheckin && !reviewCheckinDone ? (
        // Before a review: the same questions from day one — so the verdict
        // is real, not vibes. Soft gate: skipping still allows the session.
        <CareInstrumentForm
          framing="review"
          onDone={() => setReviewCheckinDone(true)}
          onSkip={() => setReviewCheckinDone(true)}
        />
      ) : null}
      {data.gate.allowed && !(n.kind === 'REVIEW' && data.needsCheckin && !reviewCheckinDone) ? (
        <>
          {n.kind === 'TREATMENT' ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {TOPICS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTopic(t)}
                  className={`rounded-full border px-3 py-1 text-xs ${
                    topic === t
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-white'
                      : 'border-[var(--color-line)] bg-[var(--color-surface)]'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          ) : null}
          <div className="mt-3">
            <MoodDial
              value={mood}
              onChange={(v) => void submitCheckin(v)}
              label="How are you feeling right now?"
            />
          </div>
          {error ? <p className="mt-2 text-sm text-[var(--color-warn)]">{error}</p> : null}
          <Button className="mt-4 w-full" disabled={starting} onClick={() => void startSession()}>
            {starting ? 'Getting ready…' : '▶ Start session'}
          </Button>
          <p className="mt-2 text-center text-[11px] text-[var(--color-ink-3)]">
            You&apos;re talking with an AI therapist. Headphones help. {data.sessionsThisWeek}/
            {data.weeklyCap} sessions this week.
          </p>
        </>
      ) : null}
      {!data.gate.allowed ? (
        <div className="mt-3 rounded-xl bg-[var(--color-surface-soft)] p-3 text-sm text-[var(--color-ink-2)]">
          {data.gate.reason}
          {data.gate.code === 'SAFETY_HOLD' ? (
            <Link
              href="/care/settings"
              className="mt-1 block font-semibold text-[var(--color-accent)]"
            >
              Do the check-in →
            </Link>
          ) : null}
          {data.gate.code === 'WEEKLY_CAP' && data.nextUnlockAt ? (
            <p className="mt-1 font-semibold">
              Your next session unlocks{' '}
              {new Date(data.nextUnlockAt).toLocaleDateString('en-IN', {
                weekday: 'long',
              })}
              .
            </p>
          ) : null}
        </div>
      ) : null}
      {data.gate.code === 'WEEKLY_CAP' ? (
        // CG3 — the graceful cap: something to DO now sits ABOVE any
        // commerce (the daily check-in still feeds the record), and the
        // quiet offer renders only when the suppression predicate allows.
        <>
          {!data.checkinToday ? (
            <div className="mt-3">
              <MoodDial
                value={mood}
                onChange={(v) => void submitCheckin(v)}
                label="Until then — the daily check-in keeps your progress moving"
              />
            </div>
          ) : null}
          {data.availableCredits > 0 ? (
            <p className="mt-3 text-[13px] font-semibold text-[var(--color-accent)]">
              {data.availableCredits} extra session{data.availableCredits === 1 ? '' : 's'} from
              your pack — ready this week.
            </p>
          ) : null}
          {!data.suppressUpsell && data.effectiveTier === 'free' && data.availableCredits === 0 ? (
            <p className="mt-3 text-[13px] text-[var(--color-ink-2)]">
              Want more this week?{' '}
              <Link href="/care/plan-tier" className="font-semibold text-[var(--color-accent)]">
                Care Plus, or a one-time 2-session pack →
              </Link>
            </p>
          ) : null}
        </>
      ) : null}
    </Card>
  );

  const planCard = data.plan ? (
    <Card className="p-4 md:p-5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
          Your plan
        </span>
        <span className="text-[11px] text-[var(--color-ink-3)]">v{data.plan.version}</span>
      </div>
      <ul className="mt-2 space-y-1.5 text-sm">
        {data.plan.goals.map((g, i) => (
          <li key={i} className="flex items-start gap-2">
            <span
              className={`mt-1 inline-block h-3.5 w-3.5 flex-shrink-0 rounded-full border-2 border-[var(--color-accent)] ${
                g.status === 'ACHIEVED' ? 'bg-[var(--color-accent)]' : ''
              }`}
            />
            <span className={g.status === 'ACHIEVED' ? 'line-through opacity-60' : ''}>
              {g.goal}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  ) : null;

  const homeworkCard = data.homework ? (
    <Card className="p-4 md:p-5">
      <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
        This week, tiny
      </span>
      <p className="mt-1 text-sm">{data.homework}</p>
      {data.homeworkTickedToday ? (
        <p className="mt-2 text-sm font-semibold text-[var(--color-accent)]">
          Done ✓ — that&apos;s {data.homeworkTicksThisWeek} day
          {data.homeworkTicksThisWeek === 1 ? '' : 's'} this week. Small is the point.
        </p>
      ) : (
        <Button variant="secondary" size="sm" className="mt-2" onClick={() => void tickHomework()}>
          Done today ✓
        </Button>
      )}
    </Card>
  ) : null;

  const lastReportCard = data.lastReport ? (
    <Link href={`/care/session/${data.lastReport.careSessionId}/report`} className="block">
      <Card className="p-4 md:p-5">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
          Last time
        </span>
        <p className="mt-1 text-sm italic">
          {data.lastReport.headline ?? 'Read your report'}{' '}
          <span className="font-semibold not-italic text-[var(--color-accent)]">→</span>
        </p>
      </Card>
    </Link>
  ) : null;

  // The starting-line re-prompt: only when a plan exists with no baseline,
  // never for a pending REVIEW (that flow has its own ask), and permanently
  // dismissible — one gentle door, not a nag.
  const baselineCard =
    data.plan && !data.hasBaseline && !baselineDismissed && n.kind !== 'REVIEW' ? (
      <Card className="p-4 md:p-5">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
          Your starting line
        </span>
        <p className="mt-1 text-sm text-[var(--color-ink-2)]">
          9 questions, about 90 seconds — the same form clinicians use. Without it, your review
          can&apos;t show real change.
        </p>
        <div className="mt-2 flex gap-2">
          <Link
            href="/care/checkin/baseline"
            className="text-sm font-semibold text-[var(--color-accent)]"
          >
            Take it now →
          </Link>
          <button
            type="button"
            onClick={() => {
              localStorage.setItem('care-baseline-later', '1');
              setBaselineDismissed(true);
            }}
            className="text-sm text-[var(--color-ink-3)] underline-offset-2 hover:underline"
          >
            Later is fine
          </button>
        </div>
      </Card>
    ) : null;

  // All three cards stack — the old `a || b || c` rendered only the first
  // truthy one, permanently hiding Homework and Last-time once a plan existed.
  const asideCards = [baselineCard, planCard, homeworkCard, lastReportCard].filter(Boolean);

  const first = data.displayName.split(' ')[0];
  const greeting =
    data.istHour >= 23 || data.istHour < 5
      ? `It's late, ${first} — good that you're here.`
      : data.istHour < 12
        ? `Good morning, ${first} ☀️`
        : data.istHour < 17
          ? `Good afternoon, ${first}`
          : `Good evening, ${first} 🌙`;

  return (
    <div className="mx-auto w-full max-w-md px-5 py-6 pb-28 md:max-w-5xl md:px-8 md:py-10">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="font-serif text-2xl font-semibold md:text-3xl">{greeting}</h1>
        {/* CG4 — the showing-up record replaces the breakable 🔥: it only
            counts up, and it freezes (null) under a safety hold. */}
        {data.record && (data.record.weeks > 0 || data.record.totalSessions > 0) ? (
          <span className="whitespace-nowrap text-right text-[12px] leading-tight text-[var(--color-ink-2)]">
            {data.record.weeks > 0 ? (
              <>
                Showing up · week {data.record.weeks}
                <br />
              </>
            ) : null}
            <span className="text-[var(--color-ink-3)]">
              {data.record.totalSessions} session{data.record.totalSessions === 1 ? '' : 's'} ·{' '}
              {data.record.totalCheckins} check-in{data.record.totalCheckins === 1 ? '' : 's'}
            </span>
          </span>
        ) : null}
      </div>
      {data.welcomeBack ? (
        <p className="mt-1 text-sm text-[var(--color-ink-2)]">
          Welcome back. Coming back is the skill — the gap doesn&apos;t erase anything.
        </p>
      ) : null}

      {asideCards.length > 0 ? (
        <div className="mt-4 md:mt-7 md:grid md:grid-cols-[1.5fr_1fr] md:items-start md:gap-6">
          <div>{sessionCard}</div>
          <div className="mt-3 space-y-3 md:mt-0">{asideCards}</div>
        </div>
      ) : (
        <div className="mt-4 md:mt-7 md:max-w-xl">{sessionCard}</div>
      )}
    </div>
  );
}
