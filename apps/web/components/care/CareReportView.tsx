'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CareReportV1 } from '@cureocity/contracts';
import { CARE_REVIEW_EVERY_N_SESSIONS } from '@/lib/care-session-kind';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { CareInstrumentForm } from './CareInstrumentForm';
import { CareShareButton } from './CareShareButton';
import { MoodDial } from './MoodDial';

interface SessionPayload {
  id: string;
  kind: 'INTAKE' | 'TREATMENT' | 'REVIEW';
  status: string;
  moodBefore: number | null;
  moodAfter: number | null;
  /// The plan version in force — a REVIEW revision carries its track and
  /// cadence forward (never a hardcoded default).
  currentPlan: { modalityTrack: string; cadence: string } | null;
  hasBaseline: boolean;
  completedCount: number;
  hasTrustedContact: boolean;
  personaName: string;
  whatsappOptedIn: boolean;
  sessionDays: number[];
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
  /// After plan-accept: the "starting line" baseline ask (CG1). Peak
  /// commitment, post-value — never a pre-intake quiz, never nagged.
  const [showBaseline, setShowBaseline] = useState(false);
  /// CG2 — the acceptance ceremony: the tap should feel like signing, not
  /// submitting. Renders between accept success and the starting line.
  const [ceremony, setCeremony] = useState<{ version: number } | null>(null);

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

  if (showBaseline) {
    return (
      <div className="mx-auto w-full max-w-md px-5 py-6 pb-28 md:max-w-2xl md:px-8 md:py-10">
        <h1 className="font-serif text-xl font-semibold">Your plan is saved ✓</h1>
        <CareInstrumentForm
          framing="baseline"
          onDone={() => router.push('/care/home')}
          onSkip={() => router.push('/care/home')}
        />
      </div>
    );
  }

  if (ceremony) {
    // Quiet and typographic — no confetti. The AI is credited, never a
    // signatory (clinical-ethics ruling: an AI countersigning a treatment
    // contract reads as an unlicensed entity executing a clinical document).
    const dateLine = new Date().toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    return (
      <div className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col items-center justify-center px-5 py-6 text-center md:max-w-2xl">
        <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-accent)]">
          Plan v{ceremony.version}
        </span>
        <h1 className="mt-2 font-serif text-3xl font-semibold">Yours, in writing.</h1>
        <p className="mt-3 max-w-sm text-sm text-[var(--color-ink-2)]">
          Goals in your words. After {CARE_REVIEW_EVERY_N_SESSIONS} sessions, the same questions
          from day one — and an honest answer about whether it&apos;s working.
        </p>
        <p className="mt-4 text-[13px] text-[var(--color-ink-3)]">
          Written with {session.personaName} (an AI). Accepted by you — {dateLine}.
        </p>
        <Button
          className="mt-8 w-full max-w-xs"
          onClick={() => {
            setCeremony(null);
            if (!session.hasBaseline) setShowBaseline(true);
            else router.push('/care/home');
          }}
        >
          Continue →
        </Button>
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
              {session.moodBefore} → {moodAfter} tonight.
            </p>
          ) : null}
          {session.moodBefore !== null && moodAfter !== null && moodAfter <= session.moodBefore ? (
            // The not-improved branch — a shame-prone user who still feels
            // heavy used to get silence here.
            <p className="mt-2 text-sm text-[var(--color-ink-2)]">
              Still heavy. That&apos;s honest — and the plan will meet you there.
            </p>
          ) : null}
        </Card>
      ) : null}

      {!session.report ? (
        <Card className="p-5 text-center">
          <div className="mx-auto h-10 w-10 animate-pulse rounded-full bg-[var(--color-accent-soft)] motion-reduce:animate-none" />
          <p className="mt-3 text-sm text-[var(--color-ink-2)]">
            {session.kind === 'INTAKE'
              ? `${session.personaName} is writing your assessment — about a minute. Your words, not a template.`
              : 'Writing your report…'}
          </p>
          <p className="mt-3 text-[13px] text-[var(--color-ink-3)]">
            While you wait — one slow breath. In… and out. That was the whole exercise. They&apos;re
            all this small.
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
        <>
          <ReportBody
            report={session.report.body}
            reportId={session.report.id}
            sessionId={sessionId}
            currentPlan={session.currentPlan}
            personaName={session.personaName}
            onAccepted={(version) => setCeremony({ version })}
          />
          {session.report.body.kind === 'TREATMENT' ? (
            <NextWeekPicker
              personaName={session.personaName}
              initialDays={session.sessionDays}
              optedIn={session.whatsappOptedIn}
            />
          ) : null}
          {session.report.body.kind === 'TREATMENT' && session.completedCount === 3 ? (
            <AlliancePulse personaName={session.personaName} />
          ) : null}
          {session.report.body.kind === 'TREATMENT' &&
          session.completedCount === 2 &&
          !session.hasTrustedContact ? (
            <Card className="mt-3 p-4">
              <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
                One quiet thing
              </span>
              <p className="mt-1 text-sm text-[var(--color-ink-2)]">
                If things ever get heavy, who should {session.personaName} mention? A trusted
                contact is shown only to you, as a one-tap call — never messaged automatically.
              </p>
              <ButtonLink variant="secondary" size="sm" className="mt-2" href="/care/settings">
                Add one in Settings →
              </ButtonLink>
            </Card>
          ) : null}
        </>
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
  reportId,
  sessionId,
  currentPlan,
  personaName,
  onAccepted,
}: {
  report: CareReportV1;
  reportId: string;
  sessionId: string;
  currentPlan: { modalityTrack: string; cadence: string } | null;
  personaName: string;
  onAccepted: (version: number) => void;
}) {
  // Always narrow on kind before reading the body — the Pass-2/3 rule.
  if (report.kind === 'INTAKE') {
    return (
      <PlanProposal
        formulation={report.assessmentAndPlan.formulation}
        concernAreas={report.assessmentAndPlan.concernAreas}
        measures={report.assessmentAndPlan.measures}
        provisionalImpression={report.assessmentAndPlan.provisionalImpression}
        proposedGoals={report.assessmentAndPlan.proposedGoals}
        modalityTrack={report.assessmentAndPlan.modalityTrack}
        cadence={report.assessmentAndPlan.cadence}
        sessionId={sessionId}
        onAccepted={onAccepted}
        staged
        reportId={reportId}
        personaName={personaName}
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
            <p>
              The scores and this conversation suggest a human therapist is the right next step. An
              AI has limits — this is one of them.
            </p>
            {/* CG6 — the rails: a recommendation without an artefact is
                designed to fail. The summary carries the plan + instrument
                series + verdicts; transcripts stay yours. */}
            <a
              href="/api/v1/care/export/handover"
              className="mt-2 inline-block text-[13px] font-semibold text-[var(--color-accent)] underline-offset-2 hover:underline"
            >
              Download a summary for your new therapist →
            </a>
            <p className="mt-1 text-[12px] text-[var(--color-ink-3)]">
              Your plan, your scores, and how the work went — no transcripts. Hand it over so you
              don&apos;t start from zero.
            </p>
          </Section>
        ) : null}
        {pr.recommendation === 'STEP_DOWN' ? (
          <Section label="The outcome we work for">
            <p>
              You&apos;re near the point where people finish. Finishing is the goal — this was never
              meant to be forever. If Plus billing was on, we&apos;ve stopped it ourselves.
            </p>
            <div className="mt-2">
              <CareShareButton kind="GRADUATION" label="Make my graduation card" />
            </div>
          </Section>
        ) : null}
        {pr.recommendation === 'CONTINUE' &&
        pr.verdicts.some(
          (v) => v.verdict.includes('improvement') || v.verdict.includes('remission'),
        ) ? (
          <Section label="Worth keeping">
            <p className="text-[13px] text-[var(--color-ink-2)]">
              Your score moved past the bar clinicians use to call change reliable. Want a card that
              says so? Numbers only — one person&apos;s numbers, not a promise.
            </p>
            <div className="mt-2">
              <CareShareButton kind="VERDICT" label="Make my progress card" />
            </div>
          </Section>
        ) : null}
        {pr.revisedGoals.length > 0 ? (
          <PlanProposal
            formulation=""
            concernAreas={[]}
            proposedGoals={pr.revisedGoals}
            // A revision carries the CURRENT plan's track + cadence forward.
            // The old hardcoded 'CBT' default silently reset a
            // SLEEP/GROUNDING user's track on every plan v2.
            modalityTrack={currentPlan?.modalityTrack ?? 'CBT'}
            cadence={currentPlan?.cadence ?? 'weekly-25min'}
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

/// CP3 — friendly labels for the measured instruments on the intake report.
const CARE_INSTRUMENT_LABELS: Record<string, string> = {
  PHQ9: 'Mood (PHQ-9)',
  GAD7: 'Anxiety (GAD-7)',
};

function PlanProposal({
  formulation,
  concernAreas,
  measures = [],
  provisionalImpression = '',
  proposedGoals,
  modalityTrack,
  cadence,
  sessionId,
  onAccepted,
  title = 'Your assessment & plan',
  staged = false,
  reportId,
  personaName,
}: {
  formulation: string;
  concernAreas: Array<{ name: string; evidenceQuote: string }>;
  measures?: Array<{ instrumentKey: string; score: number; band: string }>;
  provisionalImpression?: string;
  proposedGoals: Array<{ goal: string; why: string; measure: string }>;
  modalityTrack: string;
  cadence: string;
  sessionId: string;
  onAccepted: (version: number) => void;
  title?: string;
  /// CG2 — the INTAKE reveal is staged (tap-paced beats); REVIEW revisions
  /// stay single-screen (no formulation/quotes to pace).
  staged?: boolean;
  reportId?: string;
  personaName?: string;
}) {
  const [goals, setGoals] = useState(proposedGoals.map((g) => ({ ...g })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /// Staged reveal beats: 0 formulation · 1 in-your-words · 2 goals+terms.
  const [beat, setBeat] = useState(staged ? 0 : 2);
  const [resonance, setResonance] = useState<string | null>(null);

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
      const body = (await res.json().catch(() => ({}))) as { version?: number; error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Could not save the plan');
      onAccepted(body.version ?? 1);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  async function submitResonance(answer: 'strong' | 'mostly' | 'not_really'): Promise<void> {
    setResonance(answer);
    if (answer === 'not_really') {
      // Rupture-repair: the next session opens by asking what it missed.
      // (CareHome reads this once and sends it as the session topic.)
      try {
        localStorage.setItem(
          'care-topic-prefill',
          'You said the assessment missed something — start there.',
        );
      } catch {
        /* private mode — the repair just doesn't prefill */
      }
    }
    if (reportId) {
      await fetch(`/api/v1/care/reports/${reportId}/resonance`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ answer }),
      }).catch(() => undefined);
    }
  }

  const formulationCard = formulation ? (
    <Card className="mt-3 border-[var(--color-accent)]/30 bg-[var(--color-accent-soft)] p-4">
      <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-accent)]">
        What&apos;s going on — in plain words
      </span>
      <p className={`mt-1.5 ${staged ? 'font-serif text-[16px] leading-relaxed' : 'text-sm'}`}>
        {formulation}
      </p>
    </Card>
  ) : null;

  // CP3 — the measured "where you're starting" read (validated scales, band
  // labels), and a plain-language provisional impression. Both render only
  // when present, so pre-CP3 reports and un-measured intakes stay clean.
  const measuresCard =
    measures.length > 0 ? (
      <Card className="mt-3 p-4">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
          Where you&apos;re starting
        </span>
        <div className="mt-2 space-y-1.5">
          {measures.map((m) => (
            <div key={m.instrumentKey} className="flex items-baseline justify-between text-sm">
              <span>{CARE_INSTRUMENT_LABELS[m.instrumentKey] ?? m.instrumentKey}</span>
              <span className="font-semibold tabular-nums">
                {m.score}
                {m.band ? ` · ${m.band}` : ''}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[12px] text-[var(--color-ink-3)]">
          The same scales clinicians use — the shelf we&apos;ll measure change against, not a
          diagnosis.
        </p>
      </Card>
    ) : null;

  const impressionCard = provisionalImpression ? (
    <Card className="mt-3 p-4">
      <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
        A first impression
      </span>
      <p className="mt-1.5 text-sm">{provisionalImpression}</p>
      <p className="mt-2 text-[12px] text-[var(--color-ink-3)]">
        A screening-level impression from what you shared — not a formal diagnosis. Only a licensed
        clinician can confirm that.
      </p>
    </Card>
  ) : null;

  const quotesCard =
    concernAreas.length > 0 ? (
      <Section label="In your own words">
        {concernAreas.map((c, i) => (
          <div key={i} className="mb-2">
            <p className="font-semibold">{c.name}</p>
            {c.evidenceQuote ? (
              <p className="mt-0.5 border-l-2 border-[var(--color-accent)] pl-2 text-[13px] italic text-[var(--color-ink-2)]">
                You said — “{c.evidenceQuote}”
              </p>
            ) : null}
          </div>
        ))}
        {staged && resonance === null ? (
          <div className="mt-3 border-t border-[var(--color-line-soft)] pt-3">
            <p className="text-[13px] font-medium">Did this feel like it understood you?</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {(
                [
                  ['strong', 'Yes, strongly'],
                  ['mostly', 'Mostly'],
                  ['not_really', 'Not really'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => void submitResonance(key)}
                  className="rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1 text-xs"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {resonance === 'not_really' ? (
          <p className="mt-2 text-[13px] text-[var(--color-ink-2)]">
            Thank you for the honesty — that matters more than a polite yes. Next session,{' '}
            {personaName ?? 'your therapist'} will start by asking what she missed.
          </p>
        ) : null}
        {resonance === 'strong' || resonance === 'mostly' ? (
          <p className="mt-2 text-[13px] text-[var(--color-ink-2)]">Noted. Keep going —</p>
        ) : null}
      </Section>
    ) : null;

  const goalsSection = (
    <>
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
          How we&apos;ll work: <b>{modalityTrack}</b> track · {cadence.replace('-', ' · ')} · after{' '}
          {CARE_REVIEW_EVERY_N_SESSIONS} sessions, the same questions from day one — and an honest
          answer about whether it&apos;s working.
        </p>
      </Section>
      {error ? <p className="mt-2 text-sm text-[var(--color-warn)]">{error}</p> : null}
      <Button className="mt-4 w-full" disabled={busy} onClick={() => void accept()}>
        {busy ? 'Saving…' : 'This is my plan ✓'}
      </Button>
    </>
  );

  if (staged) {
    // The reveal: user-paced taps, no timers, no artificial delay. Beat 1
    // is the formulation ALONE — a letter, not a dashboard.
    return (
      <>
        <h1 className="font-serif text-xl font-semibold">
          {personaName ? `${personaName} wrote this for you` : title}
        </h1>
        {formulationCard}
        {measuresCard}
        {beat >= 1 ? impressionCard : null}
        {beat >= 1 ? quotesCard : null}
        {beat >= 2 ? goalsSection : null}
        {beat < 2 ? (
          <Button variant="secondary" className="mt-4 w-full" onClick={() => setBeat((b) => b + 1)}>
            Keep reading →
          </Button>
        ) : null}
      </>
    );
  }

  return (
    <>
      <h1 className="font-serif text-xl font-semibold">{title}</h1>
      {formulationCard}
      {measuresCard}
      {impressionCard}
      {quotesCard}
      {goalsSection}
    </>
  );
}

function NextWeekPicker({
  personaName,
  initialDays,
  optedIn,
}: {
  personaName: string;
  initialDays: number[];
  optedIn: boolean;
}) {
  /// CG4 — "same time next week?": a stated plan, not a calendar
  /// obligation. Picks drive the session-day reminder (only if the
  /// WhatsApp switch is on — consent is a separate, explicit tap).
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const [days, setDays] = useState<number[]>(initialDays);
  const [isOptedIn, setIsOptedIn] = useState(optedIn);
  const [saved, setSaved] = useState(false);

  async function save(patch: Record<string, unknown>): Promise<void> {
    await fetch('/api/v1/care/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    }).catch(() => undefined);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <Card className="mt-3 p-4">
      <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
        Same time next week?
      </span>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {DAYS.map((label, i) => {
          const on = days.includes(i);
          return (
            <button
              key={label}
              type="button"
              onClick={() => {
                const next = on ? days.filter((d) => d !== i) : [...days, i].slice(0, 7);
                setDays(next);
                void save({ sessionDays: next });
              }}
              className={`rounded-full border px-3 py-1 text-xs ${
                on
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-white'
                  : 'border-[var(--color-line)] bg-[var(--color-surface)]'
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
      {!isOptedIn && days.length > 0 ? (
        <button
          type="button"
          onClick={() => {
            setIsOptedIn(true);
            void save({ whatsappOptIn: true });
          }}
          className="mt-2 text-[13px] font-semibold text-[var(--color-accent)]"
        >
          Remind me on WhatsApp those evenings → (a short, plain message — stop it anytime)
        </button>
      ) : null}
      {isOptedIn && days.length > 0 ? (
        <p className="mt-2 text-[12px] text-[var(--color-ink-3)]">
          Pencilled in. {personaName} will send one plain line those evenings — Settings turns it
          off anytime.
        </p>
      ) : null}
      {saved ? <p className="mt-1 text-[12px] text-[var(--color-accent)]">Saved ✓</p> : null}
    </Card>
  );
}

function AlliancePulse({ personaName }: { personaName: string }) {
  /// CG2 — WAI-SR-short at session 3: the leading retention indicator
  /// (alliance forms in days 3–5 and predicts retention before any verdict
  /// exists). Low bond pairs with the free persona switch in Settings.
  const ITEMS = [
    ['agree', `${personaName} and I agree on what I'm working on`],
    ['heard', 'I feel heard in our sessions'],
    ['newWays', 'The sessions give me new ways of looking at my problem'],
  ] as const;
  const [scores, setScores] = useState<Record<string, number>>({});
  const [done, setDone] = useState(false);
  const complete = ITEMS.every(([k]) => scores[k] !== undefined);
  const low = complete && (scores['agree']! + scores['heard']! + scores['newWays']!) / 3 < 3;

  async function submit(): Promise<void> {
    setDone(true);
    await fetch('/api/v1/care/alliance-pulse', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(scores),
    }).catch(() => undefined);
  }

  if (done) {
    return (
      <Card className="mt-3 p-4">
        <p className="text-sm text-[var(--color-ink-2)]">
          Thanks for the honesty.{' '}
          {low ? (
            <>
              Would a different voice fit better? Dev is more direct; Asha is calmer. Your plan and
              history stay put —{' '}
              <a href="/care/settings" className="font-semibold text-[var(--color-accent)]">
                change in Settings →
              </a>
            </>
          ) : (
            'Noted — quietly, just for making this better.'
          )}
        </p>
      </Card>
    );
  }

  return (
    <Card className="mt-3 p-4">
      <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
        30 seconds, honestly
      </span>
      <p className="mt-1 text-sm text-[var(--color-ink-2)]">
        How is it going with {personaName}? (1 = rarely · 5 = always)
      </p>
      <div className="mt-2 space-y-3">
        {ITEMS.map(([key, label]) => (
          <div key={key}>
            <p className="text-[13px]">{label}</p>
            <div className="mt-1 flex gap-1.5" role="radiogroup" aria-label={label}>
              {[1, 2, 3, 4, 5].map((v) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={scores[key] === v}
                  onClick={() => setScores((cur) => ({ ...cur, [key]: v }))}
                  className={`h-8 w-8 rounded-lg text-xs font-semibold ${
                    scores[key] === v
                      ? 'bg-[var(--color-accent)] text-white'
                      : 'bg-[var(--color-surface-soft)] text-[var(--color-ink-3)]'
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <Button
        variant="secondary"
        size="sm"
        className="mt-3"
        disabled={!complete}
        onClick={() => void submit()}
      >
        Send
      </Button>
    </Card>
  );
}
