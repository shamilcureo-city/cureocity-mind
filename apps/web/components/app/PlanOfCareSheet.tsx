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
  /** Used to link section 4 back to the copilot's plan editor (?tab=copilot). */
  sessionId: string;
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
//
// `faint` carries most of the small type (section standards, table headers,
// labels) and at its old value (#988E6F on #FCFAF4) that fell below WCAG AA
// for small text, which is a large part of why the sheet read as washed out.
// Darkened to hold ~5:1 while staying clearly secondary to `ink2`.
const P = {
  bg: '#FCFAF4',
  line: '#E0D7C0',
  lineSoft: '#F0EADA',
  ink: '#241F14',
  ink2: '#5C543C',
  faint: '#7D7255',
  gold: '#7A5F16',
  good: '#0E7A4A',
  goodSoft: '#E9F5EF',
  warn: '#8A5309',
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
        className="rounded-lg border px-10 py-11 shadow-[0_24px_60px_-38px_rgba(50,40,10,0.45)] max-sm:px-5 max-sm:py-7 print:border-0 print:px-0 print:shadow-none"
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
        <h2 className="mt-3 font-serif text-[2.1rem] leading-tight" style={{ color: P.ink }}>
          {data.clientName}
        </h2>
        <div
          className="mt-2.5 flex flex-wrap gap-x-6 gap-y-1 border-b-2 pb-4 text-[11.5px]"
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
        <Section
          no={sectionNo()}
          title="Problem list"
          std="prioritised · with status"
          action={
            <SectionLink
              href={`/app/clients/${data.clientId}`}
              label="Edit"
              hint="Add, re-prioritise or resolve problems — opens the client's problem list."
            />
          }
        >
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
          action={
            <ToolsLink
              label="Edit"
              hint="Revise the formulation — opens the formulation editor in Tools below. A revision creates a new version."
            />
          }
        >
          {data.formulation ? (
            <>
              <p className="font-serif text-[14.5px] leading-[1.68]">
                {data.formulation.narrative}
                <Mark text={data.formulation.narrative} />
              </p>
              {data.formulation.cycle.length > 0 && (
                <div className="mt-4 flex flex-wrap items-stretch gap-2 text-[12px]">
                  {data.formulation.cycle.map((n, i) => (
                    <span key={i} className="flex items-stretch gap-2">
                      <span
                        className="flex max-w-[16rem] flex-col justify-start gap-1 rounded-xl border px-3 py-2 leading-snug"
                        style={
                          n.breaking
                            ? {
                                borderColor: P.gold,
                                borderStyle: 'dashed',
                                color: P.ink,
                                background: '#FBF6E7',
                              }
                            : { borderColor: P.line, color: P.ink2, background: '#FFFDF8' }
                        }
                      >
                        <b
                          className="block text-[9px] font-bold tracking-[0.14em]"
                          style={{ color: n.breaking ? P.gold : P.faint }}
                        >
                          {n.role}
                          {n.breaking ? ' · BREAKING HERE' : ''}
                        </b>
                        {n.text}
                      </span>
                      {i < data.formulation!.cycle.length - 1 && (
                        <span
                          aria-hidden
                          className="self-center text-[13px]"
                          style={{ color: P.faint }}
                        >
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
        <Section
          no={sectionNo()}
          title="Diagnosis"
          std="ICD-11"
          action={
            <ToolsLink
              label="History"
              hint="See how the diagnosis has changed over time — opens diagnosis history in Tools below. Confirm a new diagnosis from the AI Copilot tab."
            />
          }
        >
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
          action={
            <SectionLink
              href={`/app/sessions/${data.sessionId}?tab=copilot`}
              label="Edit plan"
              hint="Change the goals, measures or interventions — opens the plan editor in AI Copilot. Edits create a new plan version; nothing is overwritten."
            />
          }
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
                <GoalMeasureRow
                  planId={data.planId}
                  index={g.index}
                  status={g.status}
                  measure={g.measure}
                />
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
          action={
            <SectionLink
              href={`/app/sessions/${data.sessionId}?tab=copilot`}
              label="Record scores"
              hint="Administer or record PHQ-9 / GAD-7 — opens measures in AI Copilot. Verdicts recompute automatically."
            />
          }
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
          <Section
            no={sectionNo()}
            title="Strengths & resources"
            std="what treatment leans on"
            action={
              <ToolsLink
                label="Edit"
                hint="Strengths come from the formulation's protective factors — edit them in the formulation editor in Tools below."
              />
            }
          >
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
          action={
            <SectionLink
              href={`/app/sessions/${data.sessionId}?tab=copilot`}
              label="Review episode"
              hint="Review progress or start discharge — opens the care board in AI Copilot."
            />
          }
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
          º — proposed by the copilot, accepted by you; hover to see the client&rsquo;s words. Each
          section&rsquo;s <span className="font-semibold">Edit</span> action opens wherever that
          part of the record is kept; click a goal&rsquo;s status to cycle it (not started → in
          progress → met). Edits create a new version — nothing here is ever overwritten.
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
  action,
  children,
}: {
  no: string;
  title: string;
  std: string;
  /** Optional on-screen affordance (hidden in print — this is a document). */
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-7 first:mt-6">
      <div
        className="mb-2.5 flex items-center gap-2.5 border-b pb-1.5"
        style={{ borderColor: P.lineSoft }}
      >
        <span
          className="grid h-[18px] min-w-[18px] place-items-center rounded-full text-[9.5px] font-bold"
          style={{ background: P.lineSoft, color: P.gold }}
        >
          {no}
        </span>
        <h6
          className="text-[11.5px] font-bold uppercase tracking-[0.16em]"
          style={{ color: P.ink }}
        >
          {title}
        </h6>
        <span className="ml-auto hidden text-[10px] italic sm:inline" style={{ color: P.faint }}>
          {std}
        </span>
        {action && <span className="ml-auto shrink-0 sm:ml-2 print:hidden">{action}</span>}
      </div>
      <div className="pl-[28px] max-sm:pl-0">{children}</div>
    </div>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td className="border-b py-2.5 pr-4 align-baseline" style={{ borderColor: P.lineSoft }}>
      {children}
    </td>
  );
}

/**
 * Shared look for every per-section action chip (screen-only). Deliberately
 * quiet — the sheet is a clinical document, so the actions sit back until the
 * pointer is near, rather than competing with the record itself.
 */
const ACTION_CLASS =
  'whitespace-nowrap rounded-full border px-2.5 py-[3px] text-[10px] font-semibold no-underline opacity-70 transition-all hover:opacity-100 hover:bg-[#F3EDDC] focus-visible:opacity-100';

/** A section action that navigates elsewhere (copilot tab, client page). */
function SectionLink({ href, label, hint }: { href: string; label: string; hint: string }) {
  return (
    <a
      href={href}
      className={ACTION_CLASS}
      style={{ borderColor: P.line, color: P.gold }}
      title={hint}
    >
      {label} →
    </a>
  );
}

/**
 * A section action whose editor is the Tools drawer on THIS tab (formulation,
 * diagnosis history). Opens the collapsed <details> and scrolls to it, so the
 * therapist never has to know the tool was hiding down there.
 */
function ToolsLink({ label, hint }: { label: string; hint: string }) {
  function openTools(): void {
    const el = document.getElementById('poc-tools');
    if (el instanceof HTMLDetailsElement) {
      el.open = true;
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
  return (
    <button
      type="button"
      onClick={openTools}
      className={`${ACTION_CLASS} cursor-pointer`}
      style={{ borderColor: P.line, color: P.gold }}
      title={hint}
    >
      {label} ↓
    </button>
  );
}

const GOAL_STATUS_LABEL: Record<TreatmentGoalStatus, string> = {
  ACHIEVED: 'met',
  IN_PROGRESS: 'in progress',
  NOT_STARTED: 'not started',
};

/**
 * The measure line for one goal, with its live status control — same cycle +
 * route as PlanHero: PATCH persists to the TreatmentGoalProgress side table;
 * the plan itself is never rewritten.
 *
 * The status used to be a bare 10px dot whose only clue that it was
 * interactive was an aria-label, so in practice nobody discovered that goal
 * status was editable at all. The dot and the status WORD are now one shared
 * control: both are click targets, the word carries a hover cue + tooltip, and
 * the dot keeps its place as the measure's bullet so the printed document is
 * unchanged.
 */
function GoalMeasureRow({
  planId,
  index,
  status: initial,
  measure,
}: {
  planId: string | null;
  index: number;
  status: TreatmentGoalStatus;
  measure: string;
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

  const tone = status === 'ACHIEVED' ? P.good : status === 'IN_PROGRESS' ? P.warn : P.faint;
  const dotStyle =
    status === 'ACHIEVED'
      ? { background: P.good }
      : status === 'IN_PROGRESS'
        ? { background: P.warn }
        : { border: `1.5px solid ${P.faint}` };
  const hint = `Goal status: ${GOAL_STATUS_LABEL[status]} — click to change (not started → in progress → met)`;
  const interactive = !busy && planId !== null;

  return (
    <div className="ml-3.5 mt-1.5 flex flex-wrap items-baseline gap-2 text-[13px]">
      <button
        type="button"
        onClick={() => void cycle()}
        disabled={!interactive}
        aria-label={hint}
        title={hint}
        className="h-2.5 w-2.5 shrink-0 translate-y-[-1px] rounded-full print:pointer-events-none"
        style={dotStyle}
      />
      <span className="font-serif" style={{ color: P.ink2 }}>
        {measure}
      </span>
      <button
        type="button"
        onClick={() => void cycle()}
        disabled={!interactive}
        title={hint}
        className={`rounded text-[10px] font-bold uppercase tracking-wide underline decoration-dotted underline-offset-2 transition-opacity print:no-underline ${
          interactive ? 'cursor-pointer hover:opacity-70' : ''
        } ${busy ? 'opacity-50' : ''} print:pointer-events-none`}
        style={{ color: tone }}
      >
        {GOAL_STATUS_LABEL[status]}
      </button>
    </div>
  );
}
