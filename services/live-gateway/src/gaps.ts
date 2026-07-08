import type { EncounterGap, MedicalEncounterNoteV1 } from '@cureocity/contracts';
import {
  missingTemplateElements,
  resolveSpecialtyTemplate,
  type EncounterCompletenessInput,
} from '@cureocity/clinical';

/**
 * Sprint DV4 — Rail 3, the live gap / red-flag engine. Deterministic
 * (rule-based) — the kind of safety-net logic real CDSS use: scan the
 * rolling transcript + the building note for red-flag cues, and flag note
 * sections that aren't documented yet.
 *
 * Sprint DV6.3 — also runs the specialty-template completeness check
 * (cardiology, endocrinology …) so the ❓ nudges are specialty-aware. The
 * richer LLM differential + ICD-10 coding nudges are the batch
 * differential pass (DV6.1/6.2).
 */
const RED_FLAGS: { pattern: RegExp; message: string }[] = [
  {
    pattern: /chest pain|chest pressure|seene mein|seene me/i,
    message: 'Chest pain mentioned — consider ECG + cardiac workup (ACS red flag).',
  },
  {
    pattern: /breathless|short of breath|saans|saans phool/i,
    message: 'Breathlessness mentioned — assess oxygenation; consider cardiac/respiratory cause.',
  },
  {
    // DOC-8 — bleeding-SPECIFIC only. The old /blood\b|khoon/ fired on "blood
    // pressure", "blood test", "blood sugar" and "khoon ki jaanch" (blood
    // test), raising a critical close-gating alert on nearly every routine
    // hypertension/diabetes consult — exactly the alert-fatigue the gate is
    // meant to avoid. Match genuine bleeding phrasing instead.
    pattern:
      /bleeding|blood in (the )?(stool|urine|vomit|sputum|phlegm|cough)|(coughing|vomiting|passing|spitting|pass(ed|ing)?) (up |out )?blood|blood loss|h(a)?emorrhage|khoon (aa|beh|nikal|gir)/i,
    message: 'Bleeding mentioned — assess severity + source.',
  },
  {
    pattern: /unconscious|fainted|syncope|behosh/i,
    message: 'Syncope / loss of consciousness — red flag; assess cause urgently.',
  },
  {
    pattern: /suicid|self.?harm|khudkushi/i,
    message: 'Self-harm risk mentioned — assess safety and escalate.',
  },
];

export function detectGaps(
  transcript: string,
  note: MedicalEncounterNoteV1 | null,
  specialty?: string | null,
): EncounterGap[] {
  const hay = `${transcript}\n${
    note ? [note.chiefComplaint, note.hpi, note.assessment].join('\n') : ''
  }`.toLowerCase();

  const gaps: EncounterGap[] = [];
  for (const rf of RED_FLAGS) {
    if (rf.pattern.test(hay)) {
      gaps.push({ kind: 'RED_FLAG', severity: 'critical', message: rf.message });
    }
  }

  // Note-completeness nudges once a note is forming.
  if (note) {
    if (!note.hpi || note.hpi.trim().length === 0) {
      gaps.push({
        kind: 'MISSING_QUESTION',
        severity: 'warn',
        message: 'HPI not documented yet — onset, duration, character, aggravating/relieving.',
      });
    }
    const v = note.vitals;
    const noVitals = !v || (!v.bpSystolic && !v.heartRateBpm && !v.spo2Pct && !v.tempCelsius);
    if (noVitals) {
      gaps.push({ kind: 'MISSING_QUESTION', severity: 'info', message: 'No vitals recorded yet.' });
    }
    if (!note.physicalExam || !note.physicalExam.examined) {
      gaps.push({
        kind: 'MISSING_QUESTION',
        severity: 'info',
        message: 'Physical exam not documented (or confirm "not examined").',
      });
    }

    // Sprint DV6.3 — specialty-template completeness nudges.
    const template = resolveSpecialtyTemplate(specialty);
    if (template) {
      for (const tg of missingTemplateElements(completenessInputFor(note), template)) {
        gaps.push({
          kind: 'MISSING_QUESTION',
          severity: 'info',
          message: `${template.label}: ${tg.message}`,
        });
      }
    }
  }
  return gaps;
}

/** Project a medical note onto the primitive shape the template checker
 *  reads (decoupled from the note schema). */
function completenessInputFor(note: MedicalEncounterNoteV1): EncounterCompletenessInput {
  const v = note.vitals;
  const presentVitals: string[] = [];
  if (v?.bpSystolic) presentVitals.push('bp');
  if (v?.heartRateBpm) presentVitals.push('hr');
  if (v?.spo2Pct) presentVitals.push('spo2');
  if (v?.tempCelsius) presentVitals.push('temp');
  if (v?.weightKg) presentVitals.push('weight');
  if (v?.respRateBpm) presentVitals.push('rr');
  return {
    hpi: note.hpi ?? '',
    reviewOfSystems: note.reviewOfSystems ?? [],
    examined: note.physicalExam?.examined ?? false,
    examFindings: note.physicalExam?.findings ?? '',
    presentVitals,
  };
}
