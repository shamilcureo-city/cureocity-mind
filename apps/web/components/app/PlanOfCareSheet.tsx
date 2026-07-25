'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { TreatmentGoalStatus } from '@cureocity/contracts';
import { ShareModal } from './ShareModal';
import { formatIstDate } from '../../lib/ist';

/**
 * PC1 — the Plan of care sheet: the psychologist's clinical document.
 *
 * Structured as a case record, styled as part of the app. One column, record
 * typography (serif for clinical prose, sans for data), numbered sections in
 * the order case records are taught — problem list (POMR), formulation,
 * diagnosis, SMART goals→objectives→interventions, outcome monitoring
 * (reliable change), risk, strengths, the client's words (shared
 * decision-making), review & discharge criteria. Prints as it renders.
 *
 * Its colours come from the app's design tokens (see `P` below) rather than
 * the warm "paper" palette it originally shipped with, which made the one
 * clinical surface look foreign to every screen around it.
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
  diagnoses: {
    id: string;
    icd11Code: string;
    icd11Label: string;
    isPrimary: boolean;
    notes: string | null;
    confirmedAt: string;
  }[];
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

/**
 * The sheet's palette, mapped onto the app's design tokens (globals.css).
 *
 * This used to be a warm cream/sepia "paper" palette of its own, which made
 * the one clinical surface in the product look like it came from a different
 * app than everything around it — and its low-contrast greys fell below WCAG
 * AA for the small type they carried. It now reads as app-native: white
 * surface, the app's cool ink ramp, the app's blue accent.
 *
 * What stays document-like is the *structure*, not the colour: one column,
 * numbered sections in case-record order, serif for clinical prose and sans
 * for data. It still prints as it renders — white paper, ink-on-white.
 *
 * Kept as literal hex (not `var(--color-*)`) because these values are applied
 * through inline `style`, where a token that fails to resolve renders as
 * nothing rather than falling back. They mirror globals.css exactly.
 */
const P = {
  bg: '#ffffff', // --color-surface
  bgSoft: '#f7f9fd', // --color-bg
  line: '#e2e7ed', // --color-line
  lineSoft: '#eaeef5', // --color-line-soft
  ink: '#0a101f', // --color-ink
  ink2: '#404756', // --color-ink-2
  faint: '#717886', // --color-ink-3
  accent: '#2563eb', // --color-accent
  accentSoft: '#e8effc', // --color-accent-soft
  good: '#0f7a4a',
  goodSoft: '#e7f5ee',
  warn: '#b86a3c', // --color-warn
  warnSoft: '#fbe9dc', // --color-warn-soft
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
        style={{ color: P.accent }}
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
        className="overflow-hidden rounded-2xl border shadow-[0_18px_44px_-32px_rgba(10,16,31,0.28)] print:rounded-none print:border-0 print:shadow-none"
        style={{ background: P.bg, borderColor: P.line, color: P.ink }}
      >
        {/* Letterhead — a tinted masthead so the record has a clear front door */}
        <div
          className="border-b px-10 pb-6 pt-7 max-sm:px-5 max-sm:pt-6 print:px-0"
          style={{ background: P.bgSoft, borderColor: P.line }}
        >
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <span
              className="inline-flex items-center gap-2 text-[10.5px] font-bold uppercase tracking-[0.24em]"
              style={{ color: P.accent }}
            >
              Plan of care
              <span
                className="rounded-full px-2 py-[3px] text-[9.5px] tracking-[0.12em]"
                style={{ background: P.accentSoft, color: P.accent }}
              >
                Confidential
              </span>
            </span>
            <span className="text-right text-[11px] leading-snug" style={{ color: P.faint }}>
              {data.therapistName}
              <br />
              Cureocity Mind record
            </span>
          </div>

          <h2 className="mt-4 font-serif text-[2.15rem] leading-tight" style={{ color: P.ink }}>
            {data.clientName}
          </h2>

          {/* Key facts as discrete chips — scannable, and they wrap cleanly */}
          <div className="mt-3.5 flex flex-wrap gap-2 text-[11.5px]">
            {data.clientSince && (
              <Fact label="Care began" value={formatIstDate(new Date(data.clientSince))} />
            )}
            <Fact
              label="Session"
              value={`${data.sessionCount}${
                data.expectedDurationSessions ? ` of ~${data.expectedDurationSessions}` : ''
              }`}
            />
            {data.modality && <Fact label="Modality" value={data.modality} />}
            {data.planVersion !== null && (
              <Fact
                label="Plan"
                value={`v${data.planVersion}${
                  data.planConfirmedAt
                    ? ` · ${formatIstDate(new Date(data.planConfirmedAt))}`
                    : ' · draft'
                }`}
              />
            )}
          </div>
        </div>

        {/* Body */}
        <div className="px-10 pb-10 pt-2 max-sm:px-5 max-sm:pb-7 print:px-0">
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
                                  borderColor: P.accent,
                                  borderStyle: 'dashed',
                                  color: P.ink,
                                  background: P.accentSoft,
                                }
                              : { borderColor: P.line, color: P.ink2, background: P.bgSoft }
                          }
                        >
                          <b
                            className="block text-[9px] font-bold tracking-[0.14em]"
                            style={{ color: n.breaking ? P.accent : P.faint }}
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
                Still forming — a valid state. Add it from the copilot&rsquo;s proposals, or author
                it in Tools below.
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
              <div className="space-y-1.5">
                {data.diagnoses.map((d) => (
                  <DiagnosisRow
                    key={d.id}
                    clientId={data.clientId}
                    diagnosis={d}
                    canPromote={data.diagnoses.length > 1}
                  />
                ))}
              </div>
            ) : (
              <p className="font-serif text-sm" style={{ color: P.ink2 }}>
                No confirmed diagnosis yet — working hypotheses live in the copilot until you
                confirm one.
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
                      style={{ color: P.accent }}
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
                No plan confirmed yet — accept one from the copilot&rsquo;s Review board to start
                v1.
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
            className="mt-9 flex flex-wrap items-end justify-between gap-4 border-t pt-5"
            style={{ borderColor: P.line }}
          >
            <div>
              <div className="-rotate-2 font-serif text-[1.35rem] italic" style={{ color: P.ink2 }}>
                {data.therapistName.replace(/^Dr\.?\s*/i, '')}
              </div>
              <div className="mt-1 font-serif text-[15px]">{data.therapistName}</div>
              <div className="text-[10.5px]" style={{ color: P.faint }}>
                Clinical record · Cureocity Mind
              </div>
            </div>
            <div className="text-right text-[11px] leading-relaxed" style={{ color: P.ink2 }}>
              {data.planVersionCount > 1 && (
                <>
                  {data.planVersionCount} plan versions on record
                  <br />
                </>
              )}
              {data.lastSignedLine ?? 'No session signed yet'}
            </div>
          </div>

          <p
            className="mt-5 rounded-xl px-4 py-3 text-[11px] leading-relaxed"
            style={{ background: P.bgSoft, color: P.faint }}
          >
            <span className="font-bold" style={{ color: P.accent }}>
              º
            </span>{' '}
            — proposed by the copilot, accepted by you; hover to see the client&rsquo;s words. Each
            section&rsquo;s <span className="font-semibold">Edit</span> action opens wherever that
            part of the record is kept; click a goal&rsquo;s status to cycle it (not started → in
            progress → met). Edits create a new version — nothing here is ever overwritten.
          </p>
        </div>
      </div>

      {/* actions — outside the paper, hidden in print */}
      <div className="mt-4 flex flex-wrap gap-2 print:hidden">
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-full border border-[var(--color-line)] bg-white px-5 py-2 text-sm font-medium text-[var(--color-ink)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
        >
          Print / PDF
        </button>
        {data.planId && (
          <button
            type="button"
            onClick={() => setShareOpen(true)}
            className="rounded-full bg-[var(--color-accent)] px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)]"
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

/** A key fact in the masthead: quiet label, ink value, on one chip. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <span
      className="inline-flex items-baseline gap-1.5 rounded-lg border px-2.5 py-1"
      style={{ background: P.bg, borderColor: P.line }}
    >
      <span
        className="text-[9.5px] font-bold uppercase tracking-[0.1em]"
        style={{ color: P.faint }}
      >
        {label}
      </span>
      <span className="font-medium" style={{ color: P.ink }}>
        {value}
      </span>
    </span>
  );
}

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
    <div className="mt-8 first:mt-7">
      <div className="mb-3 flex items-center gap-2.5 border-b pb-2" style={{ borderColor: P.line }}>
        <span
          className="grid h-[20px] min-w-[20px] place-items-center rounded-md text-[10px] font-bold"
          style={{ background: P.accentSoft, color: P.accent }}
        >
          {no}
        </span>
        <h6 className="text-[12px] font-bold uppercase tracking-[0.14em]" style={{ color: P.ink }}>
          {title}
        </h6>
        <span className="ml-auto hidden text-[10.5px] sm:inline" style={{ color: P.faint }}>
          {std}
        </span>
        {action && <span className="ml-auto shrink-0 sm:ml-3 print:hidden">{action}</span>}
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
 * Shared look for every per-section action chip (screen-only). Quiet by
 * default so the record leads, but it lifts to the accent on hover/focus so
 * it is unmistakably a control.
 */
const ACTION_CLASS =
  'whitespace-nowrap rounded-lg border px-2.5 py-[4px] text-[10.5px] font-semibold no-underline transition-colors hover:border-[#2563eb] hover:bg-[#e8effc] focus-visible:border-[#2563eb] focus-visible:bg-[#e8effc] focus-visible:outline-none';

/** A section action that navigates elsewhere (copilot tab, client page). */
function SectionLink({ href, label, hint }: { href: string; label: string; hint: string }) {
  return (
    <a
      href={href}
      className={ACTION_CLASS}
      style={{ borderColor: P.line, color: P.accent }}
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
      style={{ borderColor: P.line, color: P.accent }}
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
/**
 * One confirmed diagnosis, editable in place — PC3.
 *
 * Until now a diagnosis could only be set by confirming a Pass-3 candidate,
 * so correcting a mistyped code, re-wording a label, changing which one is
 * primary, or retiring one that no longer holds all meant going back through
 * the copilot. This edits the row directly.
 *
 * Retiring supersedes rather than deletes: the row stays in the Diagnosis
 * History card, so the record shows the picture changing.
 */
function DiagnosisRow({
  clientId,
  diagnosis,
  canPromote,
}: {
  clientId: string;
  diagnosis: {
    id: string;
    icd11Code: string;
    icd11Label: string;
    isPrimary: boolean;
    notes: string | null;
  };
  canPromote: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [code, setCode] = useState(diagnosis.icd11Code);
  const [label, setLabel] = useState(diagnosis.icd11Label);
  const [notes, setNotes] = useState(diagnosis.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const base = `/api/v1/clients/${clientId}/diagnoses/${diagnosis.id}`;

  async function send(method: 'PATCH' | 'DELETE', body: unknown): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(base, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j: unknown = await res.json().catch(() => null);
        const msg =
          j && typeof j === 'object' && 'error' in j && typeof j.error === 'string'
            ? j.error
            : 'Could not save that change.';
        setError(msg);
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError('Could not reach the server.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function save(): Promise<void> {
    const trimmedCode = code.trim();
    const trimmedLabel = label.trim();
    if (trimmedCode === '' || trimmedLabel === '') {
      setError('A diagnosis needs both a code and a label.');
      return;
    }
    const ok = await send('PATCH', {
      icd11Code: trimmedCode,
      icd11Label: trimmedLabel,
      notes: notes.trim() === '' ? null : notes.trim(),
    });
    if (ok) setEditing(false);
  }

  function cancel(): void {
    setCode(diagnosis.icd11Code);
    setLabel(diagnosis.icd11Label);
    setNotes(diagnosis.notes ?? '');
    setError(null);
    setEditing(false);
  }

  if (editing) {
    return (
      <div
        className="rounded-xl border p-3 print:hidden"
        style={{ borderColor: P.accent, background: P.bgSoft }}
      >
        <div className="flex flex-wrap gap-2">
          <label className="flex-1 basis-[7rem]">
            <span
              className="text-[9.5px] font-bold uppercase tracking-[0.1em]"
              style={{ color: P.faint }}
            >
              ICD-11 code
            </span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={busy}
              className="mt-1 w-full rounded-lg border px-2.5 py-1.5 text-[13px] outline-none focus:border-[var(--color-accent)]"
              style={{ borderColor: P.line, background: P.bg, color: P.ink }}
            />
          </label>
          <label className="flex-[3] basis-[12rem]">
            <span
              className="text-[9.5px] font-bold uppercase tracking-[0.1em]"
              style={{ color: P.faint }}
            >
              Label
            </span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              disabled={busy}
              className="mt-1 w-full rounded-lg border px-2.5 py-1.5 text-[13px] outline-none focus:border-[var(--color-accent)]"
              style={{ borderColor: P.line, background: P.bg, color: P.ink }}
            />
          </label>
        </div>
        <label className="mt-2 block">
          <span
            className="text-[9.5px] font-bold uppercase tracking-[0.1em]"
            style={{ color: P.faint }}
          >
            Note (optional)
          </span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={busy}
            rows={2}
            placeholder="Why this diagnosis, or what qualifies it."
            className="mt-1 w-full resize-y rounded-lg border px-2.5 py-1.5 text-[13px] outline-none focus:border-[var(--color-accent)]"
            style={{ borderColor: P.line, background: P.bg, color: P.ink }}
          />
        </label>

        {error && (
          <p className="mt-2 text-[11.5px]" style={{ color: P.warn }}>
            {error}
          </p>
        )}

        <div className="mt-2.5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy}
            className="rounded-lg px-3 py-1.5 text-[11.5px] font-semibold text-white disabled:opacity-50"
            style={{ background: P.accent }}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={cancel}
            disabled={busy}
            className="rounded-lg border px-3 py-1.5 text-[11.5px] font-semibold disabled:opacity-50"
            style={{ borderColor: P.line, color: P.ink2, background: P.bg }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              if (
                window.confirm(
                  `Retire “${diagnosis.icd11Label}”? It stays in the diagnosis history — this records that it no longer holds.`,
                )
              ) {
                void send('DELETE', {});
              }
            }}
            disabled={busy}
            className="ml-auto rounded-lg border px-3 py-1.5 text-[11.5px] font-semibold disabled:opacity-50"
            style={{ borderColor: P.warnSoft, color: P.warn, background: P.bg }}
          >
            Retire
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex flex-wrap items-baseline gap-x-2 gap-y-1 font-serif text-sm">
      <span>
        {diagnosis.icd11Label}{' '}
        <span className="font-sans text-[11.5px]" style={{ color: P.faint }}>
          ({diagnosis.icd11Code})
        </span>
      </span>
      {diagnosis.isPrimary && (
        <span
          className="rounded-full px-2 py-[2px] font-sans text-[9.5px] font-bold uppercase tracking-[0.08em]"
          style={{ background: P.accentSoft, color: P.accent }}
        >
          Primary
        </span>
      )}
      {diagnosis.notes && (
        <span className="w-full font-sans text-[11.5px]" style={{ color: P.faint }}>
          {diagnosis.notes}
        </span>
      )}
      <span className="ml-auto flex shrink-0 gap-1.5 print:hidden">
        {!diagnosis.isPrimary && canPromote && (
          <button
            type="button"
            onClick={() => void send('PATCH', { isPrimary: true })}
            disabled={busy}
            title="Make this the primary diagnosis. The current primary is demoted."
            className="rounded-lg border px-2 py-[3px] font-sans text-[10.5px] font-semibold transition-colors hover:border-[#2563eb] hover:bg-[#e8effc] disabled:opacity-50"
            style={{ borderColor: P.line, color: P.ink2 }}
          >
            Make primary
          </button>
        )}
        <button
          type="button"
          onClick={() => setEditing(true)}
          title="Correct the code, label or note — or retire this diagnosis."
          className="rounded-lg border px-2 py-[3px] font-sans text-[10.5px] font-semibold transition-colors hover:border-[#2563eb] hover:bg-[#e8effc]"
          style={{ borderColor: P.line, color: P.accent }}
        >
          Edit
        </button>
      </span>
      {error && (
        <span className="w-full font-sans text-[11px]" style={{ color: P.warn }}>
          {error}
        </span>
      )}
    </div>
  );
}

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
