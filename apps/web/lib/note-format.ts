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
      // A SOAP note has no dedicated "intervention performed" field, so
      // BIRP is approximated: Behaviour = how the client presented,
      // Intervention/"what was worked on" draws on your read + the plan
      // (NOT the assessment alone mislabelled as "what you did"), Response
      // = the client's own account, Plan = next steps.
      return [
        { heading: 'What the client presented', term: 'Behaviour', body: join(o, s) },
        { heading: 'What was worked on', term: 'Intervention', body: join(a, p) },
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
