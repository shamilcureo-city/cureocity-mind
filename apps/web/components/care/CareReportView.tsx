'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CareReportV1 } from '@cureocity/contracts';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { MoodDial } from './MoodDial';

interface SessionPayload {
  id: string;
  kind: 'INTAKE' | 'TREATMENT' | 'REVIEW';
  status: string;
  moodBefore: number | null;
  moodAfter: number | null;
  report: { id: string; kind: string; body: CareReportV1 } | null;
}

/**
 * The report screen (AC4, S6a/S6b) — polls until Pass 10 lands, then
 * renders the kind-narrowed branch. INTAKE and REVIEW-with-revisions
 * end in the collaborative moment: editable goal cards + "This is my
 * plan" (plan acceptance is a USER action — POST /care/plan/accept).
 */
export function CareReportView({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [moodAfter, setMoodAfter] = useState<number | null>(null);
  const [polls, setPolls] = useState(0);
  const [rerunning, setRerunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/v1/care/sessions/${sessionId}`);
    if (!res.ok) {
      setError('Session not found');
      return;
    }
    const body = (await res.json()) as SessionPayload;
    setSession(body);
    if (body.moodAfter !== null) setMoodAfter(body.moodAfter);
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (session && !session.report && polls < 40) {
      const t = setTimeout(() => {
        setPolls((p) => p + 1);
        void load();
      }, 3000);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [session, polls, load]);

  async function submitMoodAfter(v: number): Promise<void> {
    setMoodAfter(v);
    await fetch(`/api/v1/care/sessions/${sessionId}/end`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ moodAfter: v }),
    }).catch(() => undefined);
  }

  async function rerun(): Promise<void> {
    setRerunning(true);
    try {
      const res = await fetch(`/api/v1/care/sessions/${sessionId}/report`, { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'Report generation failed');
      }
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRerunning(false);
    }
  }

  if (error) {
    return (
      <div className="mx-auto max-w-md px-5 py-10 text-sm text-[var(--color-warn)] md:max-w-2xl md:px-8">
        {error}
      </div>
    );
  }
  if (!session) {
    return (
      <div className="mx-auto max-w-md px-5 py-10 text-sm text-[var(--color-ink-3)] md:max-w-2xl md:px-8">
        Loading…
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md px-5 py-6 pb-28 md:max-w-2xl md:px-8 md:py-10">
      {session.moodAfter === null ? (
        <Card className="mb-4 p-4">
          <MoodDial value={moodAfter} onChange={(v) => void submitMoodAfter(v)} label="And now?" />
          {session.moodBefore !== null && moodAfter !== null && moodAfter > session.moodBefore ? (
            <p className="mt-2 text-sm font-semibold text-[var(--color-accent)]">
              {session.moodBefore} → {moodAfter} · that&apos;s movement.
            </p>
          ) : null}
        </Card>
      ) : null}

      {!session.report ? (
        <Card className="p-5 text-center">
          <div className="mx-auto h-10 w-10 animate-pulse rounded-full bg-[var(--color-accent-soft)]" />
          <p className="mt-3 text-sm text-[var(--color-ink-2)]">
            {session.kind === 'INTAKE' ? 'Writing your assessment & plan…' : 'Writing your report…'}
          </p>
          {polls > 6 ? (
            <Button
              variant="secondary"
              size="sm"
              className="mt-3"
              disabled={rerunning}
              onClick={() => void rerun()}
            >
              {rerunning ? 'Generating…' : 'Generate now'}
            </Button>
          ) : null}
        </Card>
      ) : (
        <ReportBody
          report={session.report.body}
          sessionId={sessionId}
          onAccepted={() => router.push('/care/home')}
        />
      )}

      <div className="mt-5 text-center">
        <ButtonLink variant="ghost" size="sm" href="/care/home">
          ← Back to home
        </ButtonLink>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Card className="mt-3 p-4">
      <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
        {label}
      </span>
      <div className="mt-1.5 text-sm">{children}</div>
    </Card>
  );
}

function ReportBody({
  report,
  sessionId,
  onAccepted,
}: {
  report: CareReportV1;
  sessionId: string;
  onAccepted: () => void;
}) {
  // Always narrow on kind before reading the body — the Pass-2/3 rule.
  if (report.kind === 'INTAKE') {
    return (
      <PlanProposal
        formulation={report.assessmentAndPlan.formulation}
        concernAreas={report.assessmentAndPlan.concernAreas}
        proposedGoals={report.assessmentAndPlan.proposedGoals}
        modalityTrack={report.assessmentAndPlan.modalityTrack}
        cadence={report.assessmentAndPlan.cadence}
        sessionId={sessionId}
        onAccepted={onAccepted}
      />
    );
  }
  if (report.kind === 'REVIEW') {
    const pr = report.progressReview;
    return (
      <>
        <h1 className="font-serif text-xl font-semibold">Your review</h1>
        {pr.verdicts.length > 0 ? (
          <Section label="What the scores say">
            {pr.verdicts.map((v, i) => (
              <p key={i} className="mb-1">
                <b>
                  {v.instrumentKey} {v.baselineScore} → {v.latestScore}
                </b>{' '}
                — {v.plainWords || v.verdict.replaceAll('_', ' ')}
              </p>
            ))}
          </Section>
        ) : null}
        <Section label="The stretch of work">{pr.narrative}</Section>
        {pr.goalOutcomes.length > 0 ? (
          <Section label="Goals">
            {pr.goalOutcomes.map((g, i) => (
              <p key={i}>
                Goal {g.goalIndex + 1}: <b>{g.status.toLowerCase()}</b>
                {g.note ? ` — ${g.note}` : ''}
              </p>
            ))}
          </Section>
        ) : null}
        {pr.recommendation === 'HUMAN_THERAPIST' ? (
          <Section label="An honest recommendation">
            The scores and this conversation suggest a human therapist is the right next step. An AI
            has limits — this is one of them.
          </Section>
        ) : null}
        {pr.revisedGoals.length > 0 ? (
          <PlanProposal
            formulation=""
            concernAreas={[]}
            proposedGoals={pr.revisedGoals}
            modalityTrack="CBT"
            cadence="weekly-25min"
            sessionId={sessionId}
            onAccepted={onAccepted}
            title="Your revised plan"
          />
        ) : null}
      </>
    );
  }
  const sr = report.sessionReport;
  return (
    <>
      <h1 className="font-serif text-xl font-semibold">“{sr.headline}”</h1>
      <Section label="What we worked on">{sr.summary}</Section>
      {sr.insights.length > 0 ? (
        <Section label="Worth noticing">
          {sr.insights.map((ins, i) => (
            <div key={i} className="mb-2">
              <p>{ins.observation}</p>
              {ins.evidenceQuote ? (
                <p className="mt-1 border-l-2 border-[var(--color-accent)] pl-2 text-[13px] italic text-[var(--color-ink-2)]">
                  “{ins.evidenceQuote}”
                </p>
              ) : null}
            </div>
          ))}
        </Section>
      ) : null}
      {sr.goalProgress.length > 0 ? (
        <Section label="Goal progress">
          {sr.goalProgress.map((g, i) => (
            <p key={i}>
              Goal {g.goalIndex + 1}:{' '}
              {g.movement === 'FORWARD'
                ? '▲ forward'
                : g.movement === 'BACK'
                  ? '▼ back'
                  : '— steady'}
              {g.evidence ? ` · ${g.evidence}` : ''}
            </p>
          ))}
        </Section>
      ) : null}
      {sr.homework ? (
        <Section label="Try before next time">
          <p className="font-semibold">{sr.homework.title}</p>
          {sr.homework.steps.length > 0 ? (
            <ol className="mt-1 list-decimal pl-4">
              {sr.homework.steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          ) : null}
          {sr.homework.whyItHelps ? (
            <p className="mt-1 text-[13px] text-[var(--color-ink-2)]">{sr.homework.whyItHelps}</p>
          ) : null}
        </Section>
      ) : null}
      {sr.reflectionPrompt ? <Section label="To sit with">{sr.reflectionPrompt}</Section> : null}
    </>
  );
}

function PlanProposal({
  formulation,
  concernAreas,
  proposedGoals,
  modalityTrack,
  cadence,
  sessionId,
  onAccepted,
  title = 'Your assessment & plan',
}: {
  formulation: string;
  concernAreas: Array<{ name: string; evidenceQuote: string }>;
  proposedGoals: Array<{ goal: string; why: string; measure: string }>;
  modalityTrack: string;
  cadence: string;
  sessionId: string;
  onAccepted: () => void;
  title?: string;
}) {
  const [goals, setGoals] = useState(proposedGoals.map((g) => ({ ...g })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/care/plan/accept', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceSessionId: sessionId,
          goals: goals.filter((g) => g.goal.trim().length > 0),
          modalityTrack,
          cadence,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'Could not save the plan');
      }
      onAccepted();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="font-serif text-xl font-semibold">{title}</h1>
      {formulation ? (
        <Card className="mt-3 border-[var(--color-accent)]/30 bg-[var(--color-accent-soft)] p-4">
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-accent)]">
            What&apos;s going on — in plain words
          </span>
          <p className="mt-1.5 text-sm">{formulation}</p>
        </Card>
      ) : null}
      {concernAreas.length > 0 ? (
        <Section label="What we heard">
          {concernAreas.map((c, i) => (
            <p key={i} className="mb-1">
              <b>{c.name}</b>
              {c.evidenceQuote ? (
                <span className="text-[var(--color-ink-2)]"> — “{c.evidenceQuote}”</span>
              ) : null}
            </p>
          ))}
        </Section>
      ) : null}
      <Section label="Proposed goals — edit anything">
        <div className="space-y-2">
          {goals.map((g, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="mt-2.5 inline-block h-3.5 w-3.5 flex-shrink-0 rounded-full border-2 border-[var(--color-accent)]" />
              <textarea
                value={g.goal}
                onChange={(e) =>
                  setGoals((cur) =>
                    cur.map((x, j) => (j === i ? { ...x, goal: e.target.value } : x)),
                  )
                }
                rows={2}
                className="w-full rounded-xl border border-[var(--color-line)] px-3 py-2 text-sm"
                maxLength={300}
              />
            </div>
          ))}
        </div>
        <p className="mt-2 text-[12px] text-[var(--color-ink-2)]">
          How we&apos;ll work: <b>{modalityTrack}</b> track · {cadence.replace('-', ' · ')} ·
          progress check every 2 weeks.
        </p>
      </Section>
      {error ? <p className="mt-2 text-sm text-[var(--color-warn)]">{error}</p> : null}
      <Button className="mt-4 w-full" disabled={busy} onClick={() => void accept()}>
        {busy ? 'Saving…' : 'This is my plan ✓'}
      </Button>
    </>
  );
}
