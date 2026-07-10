import type { LetterKind } from '@cureocity/contracts';
import { computeInstrumentChange } from '../instruments/change-score';
import type { InstrumentKey } from '../instruments';

/**
 * Sprint 66 / Sprint TS4 — deterministic letter composition (no LLM).
 *
 * Builds a formal letter body from a template + the client's record. The
 * therapist edits the recipient and an optional note; everything else is
 * derived so the letter is consistent and grounded in the case. Bodies are
 * plain paragraphs joined by blank lines; the PDF renders them with a
 * letterhead, date, addressee and signature.
 *
 * TS4 uplift: the REFERRAL letter now carries a real **clinical-reasoning
 * paragraph** — the therapeutic focus plus a measurement trajectory
 * (PHQ-9 / GAD-7 baseline→latest with a response/remission verdict from the
 * reliable-change engine) — and its referral rationale adapts to whether the
 * client has responded to therapy alone. Symptom scores stay in the REFERRAL
 * (clinician-to-clinician); the SUPPORT / FITNESS letters carry only the
 * non-sensitive therapeutic focus, and ATTENDANCE discloses no clinical
 * information at all. Moved into @cureocity/clinical so the composition is
 * unit-testable with golden expectations (apps/web has no test runner).
 */

/** One instrument's trajectory over the current episode (≥2 administrations). */
export interface LetterInstrumentPoint {
  instrumentKey: InstrumentKey;
  baselineScore: number;
  latestScore: number;
  administrationCount: number;
}

export interface LetterContext {
  clientFullName: string;
  therapistFullName: string;
  rciNumber: string;
  diagnosis: { icd11Code: string; icd11Label: string } | null;
  presentingConcerns: string | null;
  completedSessions: number;
  firstSessionAt: string | null;
  lastSessionAt: string | null;
  /**
   * TS4 — a plain-language phrase for the therapeutic modality/focus, e.g.
   * "cognitive behavioural therapy". Non-sensitive; appears in referral +
   * supporting letters. Null when no active plan/modality is known.
   */
  treatmentFocus?: string | null;
  /**
   * TS4 — measurement trajectory for the referral's clinical reasoning.
   * Only administrations with ≥2 readings in the episode; empty when none.
   */
  instrumentTrajectory?: LetterInstrumentPoint[];
  /** Free-text the therapist asked to include. */
  note: string | null;
}

export interface ComposedLetter {
  subject: string;
  /** Paragraphs (incl. salutation + sign-off), joined with blank lines. */
  body: string;
}

const INSTRUMENT_META: Record<InstrumentKey, { label: string; concept: string }> = {
  PHQ9: { label: 'PHQ-9', concept: 'depressive' },
  GAD7: { label: 'GAD-7', concept: 'anxiety' },
};

function fmt(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function sessionsPhrase(ctx: LetterContext): string {
  const n = ctx.completedSessions;
  const count = `${n} psychotherapy session${n === 1 ? '' : 's'}`;
  const from = fmt(ctx.firstSessionAt);
  const to = fmt(ctx.lastSessionAt);
  if (from && to && from !== to) return `${count} between ${from} and ${to}`;
  if (from) return `${count}, beginning ${from}`;
  return count;
}

/** One trajectory sentence per instrument, verdict-aware. */
function trajectorySentence(point: LetterInstrumentPoint): string {
  const meta = INSTRUMENT_META[point.instrumentKey];
  const change = computeInstrumentChange(
    point.instrumentKey,
    point.baselineScore,
    point.latestScore,
  );
  const from = `from ${point.baselineScore} to ${point.latestScore}`;
  const improved = point.baselineScore - point.latestScore;
  if (change.isRemission) {
    return `Their ${meta.label} score has fallen ${from}, now within the non-clinical range — indicating remission of ${meta.concept} symptoms.`;
  }
  if (change.isResponse) {
    const pct =
      change.percentChange !== null ? ` (a ${Math.abs(change.percentChange)}% reduction)` : '';
    return `Their ${meta.label} score has fallen ${from}${pct}, consistent with a clinical response in ${meta.concept} symptoms.`;
  }
  if (improved > 0) {
    return `Their ${meta.label} score has reduced ${from}, a partial improvement in ${meta.concept} symptoms that has not yet reached the threshold for a reliable response.`;
  }
  if (improved < 0) {
    return `Their ${meta.label} score has risen ${from}, indicating a worsening of ${meta.concept} symptoms.`;
  }
  return `Their ${meta.label} score is unchanged at ${point.latestScore}, indicating persistent ${meta.concept} symptoms.`;
}

/** True when at least one tracked instrument has NOT reached response/remission. */
function hasLimitedResponse(traj: LetterInstrumentPoint[]): boolean {
  return (
    traj.length > 0 &&
    traj.some((p) => {
      const c = computeInstrumentChange(p.instrumentKey, p.baselineScore, p.latestScore);
      return !c.isResponse && !c.isRemission;
    })
  );
}

/** The referral's clinical-reasoning paragraph (focus + measurement trajectory). */
function clinicalReasoningParagraph(ctx: LetterContext): string | null {
  const bits: string[] = [];
  if (ctx.treatmentFocus?.trim()) {
    bits.push(`The therapeutic work has focused on ${ctx.treatmentFocus.trim()}.`);
  }
  for (const point of ctx.instrumentTrajectory ?? []) {
    bits.push(trajectorySentence(point));
  }
  return bits.length > 0 ? bits.join(' ') : null;
}

export function composeLetter(kind: LetterKind, ctx: LetterContext): ComposedLetter {
  const name = ctx.clientFullName;
  const dxLine = ctx.diagnosis
    ? `The working clinical formulation is ${ctx.diagnosis.icd11Label} (ICD-11 ${ctx.diagnosis.icd11Code}).`
    : null;
  const note = ctx.note?.trim() ? ctx.note.trim() : null;
  const focusLine = ctx.treatmentFocus?.trim()
    ? `The therapeutic work has focused on ${ctx.treatmentFocus.trim()}.`
    : null;
  const signOff = 'Yours sincerely,';

  let subject: string;
  const paras: (string | null)[] = [];

  switch (kind) {
    case 'REFERRAL':
      subject = `Referral — ${name}`;
      paras.push(
        'Dear Doctor,',
        `I am writing to refer my client, ${name}, who has been under my care for psychotherapy. I have completed ${sessionsPhrase(ctx)}.`,
        ctx.presentingConcerns ? `They initially presented with: ${ctx.presentingConcerns}` : null,
        dxLine,
        // TS4 — the case-specific clinical reasoning: focus + measurement trajectory.
        clinicalReasoningParagraph(ctx),
        // TS4 — rationale adapts to the therapy response so far.
        hasLimitedResponse(ctx.instrumentTrajectory ?? [])
          ? 'Given the limited symptomatic response to psychological therapy alone to date, I would be grateful for your assessment of whether pharmacological management would be of benefit alongside continued therapy. I am happy to share a fuller case summary on request.'
          : 'I would be grateful for your assessment and your view on whether pharmacological management would be of benefit alongside ongoing therapy. I am happy to share a fuller case summary on request and to continue psychological work in parallel.',
        note,
        'Thank you for your time and consideration.',
        signOff,
      );
      break;

    case 'ATTENDANCE':
      subject = `Confirmation of attendance — ${name}`;
      paras.push(
        'To whom it may concern,',
        `This letter confirms that ${name} has attended ${sessionsPhrase(ctx)} with me.`,
        'This confirmation is provided at the client’s request for their own records. No clinical information is disclosed.',
        note,
        signOff,
      );
      break;

    case 'FITNESS':
      subject = `Supporting letter — ${name}`;
      paras.push(
        'To whom it may concern,',
        `${name} has been engaged in psychotherapy under my care (${sessionsPhrase(ctx)}).`,
        focusLine,
        'In my professional opinion, reasonable consideration and supportive accommodation during this period would assist their wellbeing and recovery. I would be glad to discuss appropriate, specific arrangements as needed.',
        note,
        signOff,
      );
      break;

    case 'SUPPORT':
    default:
      subject = `Supporting letter — ${name}`;
      paras.push(
        'To whom it may concern,',
        `I am writing in support of ${name}, who has been under my care for psychotherapy (${sessionsPhrase(ctx)}).`,
        focusLine,
        'I would be happy to provide any further information that may reasonably be required, with the client’s consent.',
        note,
        signOff,
      );
      break;
  }

  return { subject, body: paras.filter((p): p is string => Boolean(p)).join('\n\n') };
}
