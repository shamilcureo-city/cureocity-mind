import type { IntakeNoteV1, TherapyNoteV1 } from '@cureocity/contracts';

/**
 * Plain-text renderings of a note for the toolbar "Copy" action — what a
 * therapist would paste into their own EMR / email. Mirrors the readable
 * on-screen layout: a chosen template's sections when present, else the
 * Summary + named Session Topics, else the SOAP sections.
 */
function templateSectionsToText(
  sections: { title: string; body: string }[] | undefined | null,
): string | null {
  if (!sections || sections.length === 0) return null;
  return sections
    .map((s) => `${s.title.toUpperCase()}\n${s.body.trim() ? s.body.trim() : '—'}`)
    .join('\n\n');
}

export function therapyNoteToText(note: TherapyNoteV1): string {
  const templated = templateSectionsToText(note.templateSections);
  if (templated) return templated;
  const parts: string[] = [];

  if (note.summary && note.summary.trim()) {
    parts.push(`SUMMARY\n${note.summary.trim()}`);
  } else {
    parts.push(`SUBJECTIVE\n${note.subjective.trim()}`);
    if (note.objective.trim()) parts.push(`OBJECTIVE\n${note.objective.trim()}`);
  }

  if (note.topics && note.topics.length > 0) {
    const body = note.topics
      .map((t) => {
        const points = t.points.map((p) => `  - ${p}`).join('\n');
        return points ? `${t.title}\n${points}` : t.title;
      })
      .join('\n\n');
    parts.push(`SESSION TOPICS\n${body}`);
  } else {
    parts.push(`ASSESSMENT\n${note.assessment.trim()}`);
  }

  parts.push(`PLAN\n${note.plan.trim()}`);
  return parts.join('\n\n');
}

export function intakeNoteToText(note: IntakeNoteV1): string {
  const templated = templateSectionsToText(note.templateSections);
  if (templated) return templated;
  const rows: [string, string][] = [
    ['PRESENTING CONCERNS', note.presentingConcerns],
    ['HISTORY OF PRESENTING ILLNESS', note.historyOfPresentingIllness],
    ['PAST PSYCHIATRIC HISTORY', note.pastPsychiatricHistory],
    ['FAMILY HISTORY', note.familyHistory],
    ['SOCIAL HISTORY', note.socialHistory],
    ['MENTAL STATUS EXAM', note.mentalStatusExam],
    ['WORKING HYPOTHESIS', note.workingHypothesis],
    ['IMMEDIATE PLAN', note.immediatePlan],
  ];
  return rows
    .filter(([, v]) => v && v.trim())
    .map(([label, v]) => `${label}\n${v.trim()}`)
    .join('\n\n');
}
