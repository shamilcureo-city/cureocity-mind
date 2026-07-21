'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { TreatmentGoalStatus } from '@cureocity/contracts';
import { ShareModal } from './ShareModal';
import { formatIstDate } from '../../lib/ist';

/**
 * PC1 — the Plan of care sheet: the psychologist's clinical document.
 *
 * Deliberately NOT an app surface: one column, record typography (serif for
 * clinical prose, sans for data), numbered sections in the order case
 * records are taught — problem list (POMR), formulation, diagnosis, SMART
 * goals→objectives→interventions, outcome monitoring (reliable change),
 * risk, strengths, the client's words (shared decision-making), review &
 * discharge criteria. Prints as it renders.
 *
 * The copilot proposes; only what the psychologist added appears here.
 * Lines that arrived via the copilot carry a small º — its title shows the
 * client's words behind the decision.
 */

export interface PocProblem {
  title: string;
  detail: string | null;
  status: 'ACTIVE' | 'RESOLVED';
}

export interface PocCycleNode {
  role: string;
  text: string;
  breaking: boolean;
}

export interface PocGoal {
  index: number;
  description: string;
  measure: string;
  interventions: string[];
  status: TreatmentGoalStatus;
}

export interface PocOutcome {
  label: string;
  baseline: string;
  course: string;
  now: string;
  target: string;
  verdict: string;
  good: boolean;
}

export interface PlanOfCareData {
  clientId: string;
  clientName: string;
  clientSince: string | null;
  hasContactPhone: boolean;
  hasContactEmail: boolean;
  preferredLanguage: string;
  therapistName: string;
  sessionCount: number;
  modality: string | null;
  expectedDurationSessions: number | null;
  planId: string | null;
  planVersion: number | null;
  planConfirmedAt: string | null;
  planVersionCount: number;
  problems: PocProblem[];
  presentingFallback: string | null;
  formulation: {
    version: number;
    confirmedAt: string;
    narrative: string;
    cycle: PocCycleNode[];
    protective: string[];
  } | null;
  diagnoses: { icd11Code: string; icd11Label: string; isPrimary: boolean; confirmedAt: string }[];
  goals: PocGoal[];
  outcomes: PocOutcome[];
  allianceCourse: string | null;
  riskLine: string;
  riskLevel: 'low' | 'elevated' | 'none';
  agreements: { text: string; speaker: 'CLIENT' | 'THERAPIST' }[];
  reviewItems: string[];
  dischargeLine: string;
  lastSignedLine: string | null;
  /** Applied copilot suggestions: rendered text → the client's words behind it. */
  provenance: { text: string; quote: string | null }[];
}

// The paper's own palette — a document, not an app surface. Light-theme
// app; these are deliberate print-safe inks.
const P = {
  bg: '#FCFAF4',
  line: '#E7DFCC',
  lineSoft: '#F0EADA',
  ink: '#2A2418',
  ink2: '#6B6248',
  faint: '#988E6F',
  gold: '#8A6D1F',
  good: '#0E7A4A',
  goodSoft: '#E9F5EF',
  warn: '#A16207',
};

const GOAL_STATUS_CYCLE: Record<TreatmentGoalStatus, TreatmentGoalStatus> = {
  NOT_STARTED: 'IN_PROGRESS',
  IN_PROGRESS: 'ACHIEVED',
  ACHIEVED: 'NOT_STARTED',
};

export function PlanOfCareSheet({ data }: { data: PlanOfCareData }) {
  const [shareOpen, setShareOpen] = useState(false);

  // º provenance — loose match: does this rendered line correspond to an
  // applied copilot suggestion? (First 24 chars either way, lowercased.)
  const prov = (text: string): string | null => {
    const t = text.trim().toLowerCase();
    if (t === '') return null;
    for (const p of data.provenance) {
      const s = p.text.trim().toLowerCase();
      if (t.includes(s.slice(0, 24)) || s.includes(t.slice(0, 24))) {
        return p.quote ?? 'Proposed by the copilot; accepted by you.';
      }
    }
    return null;
  };

  const Mark = ({ text }: { text: string }) => {
    const quote = prov(text);
    if (!quote) return null;
    return (
      <span
        className="cursor-help font-bold"
        style={{ color: P.gold }}
        title={`Added from the copilot — her words: “${quote}”`}
      >
        {' '}
        º
      </span>
    );
  };

  const sectionNo = (() => {
    let n = 0;
    return () => String(++n);
  })();

  return (
    <div>
      <div
        className="rounded-md border px-8 py-9 shadow-[0_24px_60px_-38px_rgba(50,40,10,0.45)] max-sm:px-5 print:border-0 print:shadow-none"
        style={{ background: P.bg, borderColor: P.line, color: P.ink }}
      >
        {/* Letterhead */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <span
            className="text-[11px] font-bold uppercase tracking-[0.34em]"
            style={{ color: P.faint }}
          >
            Plan of Care · Confidential
          </span>
          <span className="text-right text-[11px]" style={{ color: P.faint }}>
            {data.therapistName}
            <br />
            Cureocity Mind record
          </span>
        </div>
        <h2 className="mt-2 font-serif text-3xl" style={{ color: P.ink }}>
          {data.clientName}
        </h2>
        <div
          className="mt-1.5 flex flex-wrap gap-x-6 gap-y-1 border-b-2 pb-4 text-[11.5px]"
          style={{ borderColor: P.ink, color: P.ink2 }}
        >
          {data.clientSince && <span>Care began {formatIstDate(new Date(data.clientSince))}</span>}
          <span>
            Session {data.sessionCount}
            {data.expectedDurationSessions ? ` of ~${data.expectedDurationSessions}` : ''}
            {data.modality ? ` · ${data.modality}` : ''}
          </span>
          {data.planVersion !== null && (
            <span>
              Plan v{data.planVersion}
              {data.planConfirmedAt
                ? ` · confirmed ${formatIstDate(new Date(data.planConfirmedAt))}`
                : ''}
            </span>
          )}
        </div>

        {/* 1 · Problem list */}
        <Section no={sectionNo()} title="Problem list" std="prioritised · with status">
          {data.problems.length > 0 ? (
            data.problems.map((p, i) => (
              <div key={i} className="mt-1.5 flex items-baseline gap-2.5 font-serif text-sm">
                <span className="text-[11px] font-bold" style={{ color: P.faint }}>
                  P{i + 1}
                </span>
                <span>{p.title}</span>
                <span
                  className="ml-auto shrink-0 rounded-full px-2.5 py-0.5 font-sans text-[10px] font-bold uppercase tracking-wide"
                  style={
                    p.status === 'ACTIVE'
                      ? { background: P.goodSoft, color: P.good }
                      : { border: `1px solid ${P.line}`, color: P.faint }
                  }
                >
                  {p.status === 'ACTIVE' ? 'active' : 'resolved'}
                </span>
              </div>
            ))
          ) : (
            <p className="font-serif text-sm" style={{ color: P.ink2 }}>
              {data.presentingFallback ??
                'No problems recorded yet — name them from the Client page as the picture settles.'}
            </p>
          )}
        </Section>

        {/* 2 · Formulation */}
        <Section
          no={sectionNo()}
          title="Case formulation"
          std={
            data.formulation
              ? `the working hypothesis · v${data.formulation.version}`
              : 'the working hypothesis'
          }
        >
          {data.formulation ? (
            <>
              <p className="font-serif text-[14.5px] leading-[1.68]">
                {data.formulation.narrative}
                <Mark text={data.formulation.narrative} />
              </p>
              {data.formulation.cycle.length > 0 && (
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11.5px]">
                  {data.formulation.cycle.map((n, i) => (
                    <span key={i} className="flex items-center gap-1.5">
                      <span
                        className="rounded-lg border px-2.5 py-1"
                        style={
                          n.breaking
                            ? { borderColor: P.gold, borderStyle: 'dashed', color: P.ink }
                            : { borderColor: P.line, color: P.ink2 }
                        }
                      >
                        <b
                          className="block text-[9px] font-bold tracking-[0.12em]"
                          style={{ color: n.breaking ? P.gold : P.faint }}
                        >
                          {n.role}
                          {n.breaking ? ' · BREAKING HERE' : ''}
                        </b>
                        {n.text}
                      </span>
                      {i < data.formulation!.cycle.length - 1 && (
                        <span aria-hidden style={{ color: P.faint }}>
                          →
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="font-serif text-sm" style={{ color: P.ink2 }}>
              Still forming — a valid state. Add it from the copilot&rsquo;s proposals, or author it
              in Tools below.
            </p>
          )}
        </Section>

        {/* 3 · Diagnosis */}
        <Section no={sectionNo()} title="Diagnosis" std="ICD-11">
          {data.diagnoses.length > 0 ? (
            <p className="font-serif text-sm">
              {data.diagnoses.map((d, i) => (
                <span key={d.icd11Code}>
                  {i > 0 && ' · '}
                  {d.icd11Label} ({d.icd11Code}){d.isPrimary ? ' — primary' : ''}
                </span>
              ))}
            </p>
          ) : (
            <p className="font-serif text-sm" style={{ color: P.ink2 }}>
              No confirmed diagnosis yet — working hypotheses live in the copilot until you confirm
              one.
            </p>
          )}
        </Section>

        {/* 4 · Goals */}
        <Section
          no={sectionNo()}
          title="Goals · objectives · interventions"
          std="SMART · each objective measured"
        >
          {data.goals.length > 0 ? (
            data.goals.map((g) => (
              <div
                key={g.index}
                className="mt-3.5 border-l-2 pl-4"
                style={{ borderColor: g.status === 'ACHIEVED' ? P.good : P.line }}
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <span
                    className="text-[10.5px] font-extrabold tracking-wide"
                    style={{ color: P.gold }}
                  >
                    G{g.index + 1}
                  </span>
                  <span className="font-serif text-[15px]">
                    {g.description}
                    <Mark text={g.description} />
                  </span>
                </div>
                <div className="ml-3.5 mt-1.5 flex flex-wrap items-baseline gap-2 text-[13px]">
                  <GoalDot planId={data.planId} index={g.index} status={g.status} />
                  <span className="font-serif" style={{ color: P.ink2 }}>
                    {g.measure}
                  </span>
                  <span
                    className="text-[10px] font-bold uppercase tracking-wide"
                    style={{
                      color:
                        g.status === 'ACHIEVED'
                          ? P.good
                          : g.status === 'IN_PROGRESS'
                            ? P.warn
                            : P.faint,
                    }}
                  >
                    {g.status === 'ACHIEVED'
                      ? 'met'
                      : g.status === 'IN_PROGRESS'
                        ? 'in progress'
                        : 'not started'}
                  </span>
                </div>
                {g.interventions.length > 0 && (
                  <div className="ml-3.5 mt-2 flex flex-wrap gap-1.5">
                    {g.interventions.map((iv) => (
                      <span
                        key={iv}
                        className="rounded-full border px-2.5 py-0.5 text-[10.5px] font-semibold"
                        style={{ borderColor: P.line, color: P.ink2 }}
                      >
                        {iv}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))
          ) : (
            <p className="font-serif text-sm" style={{ color: P.ink2 }}>
              No plan confirmed yet — accept one from the copilot&rsquo;s Review board to start v1.
            </p>
          )}
        </Section>

        {/* 5 · Outcome monitoring */}
        <Section
          no={sectionNo()}
          title="Outcome monitoring"
          std="reliable change per Jacobson–Truax"
        >
          {data.outcomes.length > 0 || data.allianceCourse ? (
            <div className="overflow-x-auto">
              <table className="mt-1 w-full border-collapse">
                <thead>
                  <tr>
                    {['Measure', 'Baseline', 'Course', 'Now', 'Target', 'Verdict'].map((h) => (
                      <th
                        key={h}
                        className="border-b pb-1 pr-3 text-left text-[9.5px] font-bold uppercase tracking-[0.14em]"
                        style={{ borderColor: P.line, color: P.faint }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="text-[12.5px] tabular-nums">
                  {data.outcomes.map((o) => (
                    <tr key={o.label}>
                      <Td>{o.label}</Td>
                      <Td>{o.baseline}</Td>
                      <Td>
                        <span style={{ color: P.faint }}>{o.course}</span>
                      </Td>
                      <Td>
                        <b>{o.now}</b>
                      </Td>
                      <Td>{o.target}</Td>
                      <Td>
                        <span
                          className="text-[10px] font-bold uppercase tracking-wide"
                          style={{ color: o.good ? P.good : P.ink2 }}
                        >
                          {o.verdict}
                        </span>
                      </Td>
                    </tr>
                  ))}
                  {data.allianceCourse && (
                    <tr>
                      <Td>Alliance</Td>
                      <Td>—</Td>
                      <Td>
                        <span style={{ color: P.faint }}>{data.allianceCourse}</span>
                      </Td>
                      <Td>—</Td>
                      <Td>—</Td>
                      <Td>
                        <span className="text-[10px]" style={{ color: P.ink2 }}>
                          your one-tap read, per session
                        </span>
                      </Td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="font-serif text-sm" style={{ color: P.ink2 }}>
              No measures administered yet. Baselines anchor everything above — administer PHQ-9 /
              GAD-7 from the copilot&rsquo;s Progress view.
            </p>
          )}
        </Section>

        {/* 6 · Risk & safety */}
        <Section no={sectionNo()} title="Risk & safety" std="status, not drama">
          <p className="text-[12.5px]" style={{ color: P.ink2 }}>
            {data.riskLevel !== 'none' && (
              <b
                className="mr-2 text-[11px] font-extrabold uppercase tracking-wide"
                style={{ color: data.riskLevel === 'low' ? P.good : P.warn }}
              >
                Current: {data.riskLevel}
              </b>
            )}
            {data.riskLine}
          </p>
        </Section>

        {/* 7 · Strengths */}
        {data.formulation && data.formulation.protective.length > 0 && (
          <Section no={sectionNo()} title="Strengths & resources" std="what treatment leans on">
            <p className="font-serif text-[13.5px]">
              {data.formulation.protective.map((s, i) => (
                <span key={i}>
                  {i > 0 && ' · '}
                  {s}
                  <Mark text={s} />
                </span>
              ))}
            </p>
          </Section>
        )}

        {/* 8 · Agreed with the client */}
        {data.agreements.length > 0 && (
          <Section
            no={sectionNo()}
            title={`Agreed with ${data.clientName.split(' ')[0]}`}
            std="shared decision-making · their words"
          >
            {data.agreements.map((a, i) => (
              <p key={i} className="mt-1.5 font-serif text-[14.5px]">
                {a.speaker === 'CLIENT' ? <em>&ldquo;{a.text}&rdquo;</em> : a.text}{' '}
                <span className="font-sans text-[11px]" style={{ color: P.faint }}>
                  — {a.speaker === 'CLIENT' ? 'their commitment' : 'clinician'}
                </span>
              </p>
            ))}
          </Section>
        )}

        {/* 9 · Review & discharge */}
        <Section
          no={sectionNo()}
          title="Review & discharge criteria"
          std="episode of care, not open-ended"
        >
          {data.reviewItems.map((r, i) => (
            <div key={i} className="mt-1.5 flex items-baseline gap-2.5 text-[13.5px]">
              <span className="font-sans text-[11px]" style={{ color: P.faint }}>
                Review
              </span>
              <span className="font-serif">{r}</span>
            </div>
          ))}
          <div className="mt-1.5 flex items-baseline gap-2.5 text-[13.5px]">
            <span className="shrink-0 font-sans text-[11px]" style={{ color: P.faint }}>
              Discharge when
            </span>
            <span className="font-serif">{data.dischargeLine}</span>
          </div>
        </Section>

        {/* Signature */}
        <div
          className="mt-7 flex flex-wrap items-end justify-between gap-4 border-t-2 pt-3.5"
          style={{ borderColor: P.ink }}
        >
          <div>
            <div
              className="-rotate-2 font-serif text-xl italic opacity-85"
              style={{ color: P.ink }}
            >
              {data.therapistName.replace(/^Dr\.?\s*/i, '')}
            </div>
            <div className="font-serif text-[15px]">{data.therapistName}</div>
            <div className="text-[10.5px]" style={{ color: P.faint }}>
              Clinical record · Cureocity Mind
            </div>
          </div>
          <div className="text-right text-[11px]" style={{ color: P.ink2 }}>
            {data.planVersionCount > 1 && (
              <>
                {data.planVersionCount} plan versions on record
                <br />
              </>
            )}
            {data.lastSignedLine ?? 'No session signed yet'}
          </div>
        </div>

        <p className="mt-3 text-[11px]" style={{ color: P.faint }}>
          º — proposed by the copilot, accepted by you; hover to see the client&rsquo;s words. Goal
          dots cycle not started → in progress → met. Edits version the plan — nothing here is ever
          overwritten.
        </p>
      </div>

      {/* actions — outside the paper, hidden in print */}
      <div className="mt-4 flex flex-wrap gap-2 print:hidden">
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-full border border-[var(--color-line)] bg-white px-5 py-2 text-sm font-medium text-[var(--color-ink)] hover:border-[var(--color-accent)]"
        >
          Print / PDF
        </button>
        {data.planId && (
          <button
            type="button"
            onClick={() => setShareOpen(true)}
            className="rounded-full bg-[var(--color-ink)] px-5 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Share with {data.clientName.split(' ')[0]}
          </button>
        )}
      </div>

      {data.planId && (
        <ShareModal
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          clientId={data.clientId}
          hasContactPhone={data.hasContactPhone}
          hasContactEmail={data.hasContactEmail}
          artefact={{ artefactType: 'TREATMENT_PLAN', treatmentPlanId: data.planId }}
          artefactLabel="Treatment plan"
          defaultLanguage={data.preferredLanguage}
        />
      )}
    </div>
  );
}

// ----- pieces -----

function Section({
  no,
  title,
  std,
  children,
}: {
  no: string;
  title: string;
  std: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-6">
      <div className="mb-2 flex items-baseline gap-2.5">
        <span
          className="min-w-[16px] text-[10px] font-bold tracking-wide"
          style={{ color: P.faint }}
        >
          {no}
        </span>
        <h6 className="text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: P.ink2 }}>
          {title}
        </h6>
        <span className="ml-auto text-[10px] italic" style={{ color: P.faint }}>
          {std}
        </span>
      </div>
      <div className="pl-[26px] max-sm:pl-0">{children}</div>
    </div>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td className="border-b py-1.5 pr-3 align-baseline" style={{ borderColor: P.lineSoft }}>
      {children}
    </td>
  );
}

/**
 * Live goal-status dot — same cycle + route as PlanHero: PATCH persists to
 * the TreatmentGoalProgress side table; the plan itself is never rewritten.
 */
function GoalDot({
  planId,
  index,
  status: initial,
}: {
  planId: string | null;
  index: number;
  status: TreatmentGoalStatus;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<TreatmentGoalStatus>(initial);
  const [busy, setBusy] = useState(false);

  async function cycle(): Promise<void> {
    if (busy || !planId) return;
    const next = GOAL_STATUS_CYCLE[status];
    setStatus(next);
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/treatment-plans/${planId}/goals/${index}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        setStatus(initial);
        return;
      }
      router.refresh();
    } catch {
      setStatus(initial);
    } finally {
      setBusy(false);
    }
  }

  const style =
    status === 'ACHIEVED'
      ? { background: P.good }
      : status === 'IN_PROGRESS'
        ? { background: P.warn }
        : { border: `1.5px solid ${P.faint}` };

  return (
    <button
      type="button"
      onClick={() => void cycle()}
      disabled={busy || !planId}
      aria-label={`Goal status: ${status.toLowerCase().replace('_', ' ')} — tap to change`}
      className="h-2.5 w-2.5 shrink-0 translate-y-[-1px] rounded-full print:pointer-events-none"
      style={style}
    />
  );
}
