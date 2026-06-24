import type { LetterKind } from '@cureocity/contracts';

/**
 * Sprint 66 — deterministic letter composition (no LLM).
 *
 * Builds a formal letter body from a template + the client's record. The
 * therapist edits the recipient and an optional note; everything else is
 * derived so the letter is consistent and grounded in the case. Bodies are
 * plain paragraphs joined by blank lines; the PDF renders them with a
 * letterhead, date, addressee and signature.
 */

export interface LetterContext {
  clientFullName: string;
  therapistFullName: string;
  rciNumber: string;
  diagnosis: { icd11Code: string; icd11Label: string } | null;
  presentingConcerns: string | null;
  completedSessions: number;
  firstSessionAt: string | null;
  lastSessionAt: string | null;
  /** Free-text the therapist asked to include. */
  note: string | null;
}

export interface ComposedLetter {
  subject: string;
  /** Paragraphs (incl. salutation + sign-off), joined with blank lines. */
  body: string;
}

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

export function composeLetter(kind: LetterKind, ctx: LetterContext): ComposedLetter {
  const name = ctx.clientFullName;
  const dxLine = ctx.diagnosis
    ? `The working clinical formulation is ${ctx.diagnosis.icd11Label} (ICD-11 ${ctx.diagnosis.icd11Code}).`
    : null;
  const note = ctx.note?.trim() ? ctx.note.trim() : null;
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
        'I would be grateful for your assessment and your view on whether pharmacological management would be of benefit alongside ongoing therapy. I am happy to share a fuller case summary on request and to continue psychological work in parallel.',
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
        'I would be happy to provide any further information that may reasonably be required, with the client’s consent.',
        note,
        signOff,
      );
      break;
  }

  return { subject, body: paras.filter((p): p is string => Boolean(p)).join('\n\n') };
}
