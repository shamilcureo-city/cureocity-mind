'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
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
  plan: {
    version: number;
    goals: Array<{ goal: string; status: string }>;
    modalityTrack: string;
  } | null;
  homework: string | null;
  streak: number;
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
      const res = await fetch('/api/v1/care/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(mood !== null ? { moodBefore: mood } : {}),
          ...(data.nextSession.kind === 'TREATMENT' ? { topic } : {}),
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
      {data.gate.allowed ? (
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
      ) : (
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
        </div>
      )}
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
        Homework
      </span>
      <p className="mt-1 text-sm">{data.homework}</p>
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

  const aside = planCard || homeworkCard || lastReportCard;

  return (
    <div className="mx-auto w-full max-w-md px-5 py-6 pb-28 md:max-w-5xl md:px-8 md:py-10">
      <div className="flex items-baseline justify-between">
        <h1 className="font-serif text-2xl font-semibold md:text-3xl">
          Good evening, {data.displayName.split(' ')[0]} 🌙
        </h1>
        {data.streak > 0 ? (
          <span className="text-sm text-[var(--color-ink-2)]">🔥 {data.streak}</span>
        ) : null}
      </div>

      {aside ? (
        <div className="mt-4 md:mt-7 md:grid md:grid-cols-[1.5fr_1fr] md:items-start md:gap-6">
          <div>{sessionCard}</div>
          <div className="mt-3 space-y-3 md:mt-0">{aside}</div>
        </div>
      ) : (
        <div className="mt-4 md:mt-7 md:max-w-xl">{sessionCard}</div>
      )}
    </div>
  );
}
