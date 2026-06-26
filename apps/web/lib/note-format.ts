import type { TherapyNoteV1 } from '@cureocity/contracts';

/**
 * Sprint 62b — note-format views.
 *
 * The AI writes the note once (SOAP-shaped). This lets a therapist read it
 * arranged the way *they* write — DAP, BIRP, or one flowing narrative —
 * by deterministically re-mapping the same content. No model call, no
 * change to what's stored or signed. (Native per-format *generation* is a
 * later, GCP-dependent step.)
 */

export type NoteFormat = 'SOAP' | 'DAP' | 'BIRP' | 'NARRATIVE';

export const NOTE_FORMATS: NoteFormat[] = ['SOAP', 'DAP', 'BIRP', 'NARRATIVE'];

export const NOTE_FORMAT_LABEL: Record<NoteFormat, string> = {
  SOAP: 'SOAP',
  DAP: 'DAP',
  BIRP: 'BIRP',
  NARRATIVE: 'Narrative',
};

export function isNoteFormat(v: string | null | undefined): v is NoteFormat {
  return v === 'SOAP' || v === 'DAP' || v === 'BIRP' || v === 'NARRATIVE';
}

/**
 * Sprint 70 — note verbosity (the "Detailed" dropdown in the reference).
 * Like the format switch, this is a VIEW density control — it changes how
 * much of the same note is shown, with no model call or change to what's
 * stored. (True re-generation at a length is the GCP-dependent follow-up,
 * same as native per-format generation.)
 *
 * - BRIEF        → the Summary + the plan, at a glance
 * - DETAILED     → Summary + Session topics + plan (the default)
 * - VERY_DETAILED→ Detailed + the underlying clinical prose (subjective /
 *                  objective / full assessment)
 */
export type NoteVerbosity = 'BRIEF' | 'DETAILED' | 'VERY_DETAILED';

export const NOTE_VERBOSITIES: NoteVerbosity[] = ['BRIEF', 'DETAILED', 'VERY_DETAILED'];

export const NOTE_VERBOSITY_LABEL: Record<NoteVerbosity, string> = {
  BRIEF: 'Brief',
  DETAILED: 'Detailed',
  VERY_DETAILED: 'Very detailed',
};

export function isNoteVerbosity(v: string | null | undefined): v is NoteVerbosity {
  return v === 'BRIEF' || v === 'DETAILED' || v === 'VERY_DETAILED';
}

export const NOTE_VERBOSITY_HELP = {
  plainTitle: 'How much detail',
  what: 'Shows the same note at the length you want: Brief is a quick glance (summary + plan), Detailed is the full readable note, and Very detailed also shows the underlying clinical wording.',
  why: 'It only changes how much is shown on screen — never what was written or stored. Remembered on this device.',
};

export interface FormatSection {
  /** Plain-language heading. */
  heading: string;
  /** The clinical letter/term, shown small. */
  term?: string;
  body: string;
}

function join(...parts: string[]): string {
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Re-arrange a SOAP note into the requested format. SOAP is returned by
 * the caller's richer layout; this covers DAP / BIRP / Narrative.
 */
export function formatNoteSections(note: TherapyNoteV1, format: NoteFormat): FormatSection[] {
  const s = note.subjective ?? '';
  const o = note.objective ?? '';
  const a = note.assessment ?? '';
  const p = note.plan ?? '';

  switch (format) {
    case 'DAP':
      return [
        { heading: 'What came up', term: 'Data', body: join(s, o) },
        { heading: 'What you make of it', term: 'Assessment', body: a },
        { heading: 'The plan', term: 'Plan', body: p },
      ];
    case 'BIRP':
      // A SOAP note has no dedicated "intervention performed" field, so BIRP
      // is a best-effort 1:1 re-map with NO field shown twice: Behaviour =
      // what was observed (objective), Intervention/"what was worked on" is
      // approximated from your clinical read (assessment), Response = the
      // client's own account (subjective), Plan = next steps. Earlier this
      // duplicated subjective into both Behaviour and Response, and the plan
      // into both Intervention and Plan — which read like a rendering bug on
      // a real note. Each SOAP field now maps to exactly one BIRP section.
      return [
        { heading: 'What the client presented', term: 'Behaviour', body: o },
        { heading: 'What was worked on', term: 'Intervention', body: a },
        { heading: 'How they responded', term: 'Response', body: s },
        { heading: 'The plan', term: 'Plan', body: p },
      ];
    case 'NARRATIVE':
      return [{ heading: 'Session note', term: 'Narrative', body: join(s, o, a, p) }];
    case 'SOAP':
    default:
      return [
        { heading: 'What the client shared', term: 'Subjective', body: s },
        { heading: 'What you observed', term: 'Objective', body: o },
        { heading: 'What you make of it', term: 'Assessment', body: a },
        { heading: 'The plan', term: 'Plan', body: p },
      ];
  }
}

/** Plain "which should I pick?" copy for the format switch. */
export const NOTE_FORMAT_HELP = {
  plainTitle: 'Note formats',
  what: 'The same note, arranged the way you like to write. SOAP and DAP lead with what came up then your read and the plan; BIRP centres on behaviour, what you did, and how the client responded; Narrative is one flowing write-up.',
  why: 'Pick whichever matches how you were trained — it only changes the arrangement, never the content. Your choice is remembered on this device.',
};
