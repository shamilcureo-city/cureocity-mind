import type {
  ClinicalOrderV1,
  MedicalEncounterNoteV1,
  MedicationOrderV1,
  PatientContext,
  RxInvestigation,
  RxMedRow,
  RxPadV1,
  VoiceCommand,
} from '@cureocity/contracts';
import { allergyWarningsByDrug, drugNameKey } from '@cureocity/clinical';

/**
 * Sprint DS5 — deterministic Rx pad assembly.
 *
 * The pad is a structured re-presentation of what already flows through the
 * pipeline, gathered from three sources:
 *   - CONTINUED  — the patient's active meds (from context) auto-carry.
 *   - DRAFTED    — the Pass-2 medical note's medications (AI-suggested).
 *   - SPOKEN     — voice-command meds (the DV6.4 parser, the fast path).
 * EVERY med row lands `pending` — drafted, spoken and continued alike — and
 * needs an explicit confirm tap. (Batch B: continued rows used to land
 * `confirmed`, which quietly reissued a repeat prescription nobody looked at.)
 * Investigations come from the clinical orders + spoken "order X" commands.
 * Nothing auto-prescribes.
 *
 * Pure + DB-free so it unit-tests directly. `clean` strips the dev [mock] tag.
 */

const MOCK_TAG = /^\s*\[mock\]\s*/i;
function clean(s: string | undefined): string {
  return (s ?? '').replace(MOCK_TAG, '').trim();
}

/**
 * Batch B — the shared drug-name key (see @cureocity/clinical/drug-key).
 * This used to be `first word, lowercased`, which merged "Insulin glargine"
 * with "Insulin aspart" and made the pad unable to hold both.
 */
function drugKey(drug: string): string {
  return drugNameKey(clean(drug));
}

export interface RxPadInput {
  patient: PatientContext;
  note: MedicalEncounterNoteV1 | null;
  medications: MedicationOrderV1[];
  orders: ClinicalOrderV1[];
  voiceCommands: VoiceCommand[];
}

export function assembleRxPad(input: RxPadInput): RxPadV1 {
  const { patient, note, medications, orders, voiceCommands } = input;

  const meds: RxMedRow[] = [];
  const byDrug = new Map<string, number>(); // key → index in `meds`
  /**
   * Batch B — a same-drug row now SUPERSEDES rather than being dropped.
   *
   * The old rule was "first row for a drug wins". Continued meds are added
   * first, so when the doctor said "increase her metformin to 1g" the spoken
   * row was silently discarded and the pad kept printing the OLD 500mg —
   * a dose change that vanished between the doctor's mouth and the slip.
   * Now the later, more specific instruction replaces the standing row, keeps
   * its `continued` badge (it IS a change to a standing med), and lands
   * `pending` so the doctor confirms the new dose deliberately.
   */
  const pushMed = (row: RxMedRow) => {
    const key = drugKey(row.drug);
    if (!key) return;
    const existing = byDrug.get(key);
    if (existing === undefined) {
      byDrug.set(key, meds.length);
      meds.push(row);
      return;
    }
    const prior = meds[existing]!;
    // Supersede only when the new row speaks with MORE authority. Sources are
    // pushed continued → spoken → drafted, so a plain "later wins" rule would
    // let the model's inferred med overwrite what the doctor actually said —
    // exactly backwards. What the doctor spoke always outranks what Pass 2
    // inferred, which in turn outranks a standing repeat.
    if (sourceRank(row) < sourceRank(prior)) return;
    meds[existing] = {
      ...row,
      // A change to a standing med stays flagged as continued, so the pad
      // shows "was 500mg BD" rather than reading as a brand-new drug.
      continued: prior.continued || row.continued,
      status: 'pending',
      ...(prior.continued && !row.continued ? { previous: prior.drug } : {}),
    };
  };

  // 1. Continued meds from the patient's active list.
  //
  // Batch B — these used to land `confirmed`, which quietly contradicted the
  // "nothing auto-prescribes" rule this file opens with: a repeat prescription
  // was reissued without the doctor looking at it. They now land `pending`
  // like every other row — one tap to re-authorise, which is the point.
  for (const active of patient.activeMeds) {
    if (!active.trim()) continue;
    pushMed({
      // The active-med string carries its own dosing ("Metformin 500 BD");
      // keep it verbatim so nothing is lost between the chart and the slip.
      drug: active.trim(),
      continued: true,
      status: 'pending',
      warnings: [],
    });
  }

  // 2. Spoken meds (voice-command fast path) — pending confirm. DS11.5-fu:
  // carry the source utterance so the pad row gets a 🗣 quote-chip.
  for (const cmd of voiceCommands) {
    if (cmd.kind !== 'ADD_MEDICATION') continue;
    pushMed({
      drug: cmd.drug,
      ...(cmd.strength ? { strength: cmd.strength } : {}),
      ...(cmd.frequency ? { frequency: cmd.frequency } : {}),
      ...(cmd.durationDays ? { durationDays: cmd.durationDays } : {}),
      continued: false,
      status: 'pending',
      warnings: [],
      // Batch C — provenance. A HEARD row is anchored to a real utterance;
      // the badge + the 🗣 chip let the doctor tell it apart at a glance from
      // one the model wrote unprompted.
      source: 'dictated',
      ...(cmd.utteranceId ? { utteranceId: cmd.utteranceId } : {}),
    });
  }

  // 3. Drafted meds from the Pass-2 note — pending confirm.
  for (const m of medications) {
    pushMed({
      drug: clean(m.drug),
      ...(m.strength ? { strength: m.strength } : {}),
      ...(m.dose ? { dose: m.dose } : {}),
      ...(m.frequency ? { frequency: clean(m.frequency) } : {}),
      ...(m.instructions ? { timing: clean(m.instructions) } : {}),
      ...(m.durationDays ? { durationDays: m.durationDays } : {}),
      ...(m.route ? { route: m.route } : {}),
      continued: false,
      status: 'pending',
      warnings: m.interactionWarnings ?? [],
      // Batch C — an AI-DRAFTED med has no spoken instruction behind it: the
      // model inferred it from the consult. Gateway rows used to carry no
      // provenance at all, so these were visually identical to something the
      // doctor actually said. Badge them, so the rows that need scrutiny are
      // the ones that look like they need scrutiny.
      source: 'ai',
    });
  }

  // Investigations from clinical orders + spoken "order X" commands.
  const investigations: RxInvestigation[] = [];
  const seenInv = new Set<string>();
  const pushInv = (name: string, rationale?: string, utteranceId?: string) => {
    const clip = clean(name);
    const key = clip.toLowerCase();
    if (!clip || seenInv.has(key)) return;
    seenInv.add(key);
    investigations.push({
      name: clip,
      ...(rationale ? { rationale: clean(rationale) } : {}),
      ...(utteranceId ? { utteranceId } : {}),
    });
  };
  const adviceLines: string[] = [];
  for (const o of orders) {
    if (o.category === 'REFERRAL') adviceLines.push(`Refer: ${clean(o.description)}`);
    else pushInv(o.description, o.rationale);
  }
  for (const cmd of voiceCommands) {
    if (cmd.kind === 'ORDER_TEST') pushInv(cmd.description, undefined, cmd.utteranceId);
  }

  // Advice + follow-up from the plan; dx line + vitals from the note.
  for (const line of splitPlan(clean(note?.plan))) {
    if (!mentionsOrderOrMed(line, meds, investigations)) adviceLines.push(line);
  }
  const followUp = parseFollowUp(clean(note?.plan));

  // Batch B — stamp allergy warnings per row. The pad printed the patient's
  // allergy list at the top and never compared it to what was on the slip;
  // now the offending row carries the alert itself. Allergy lines go FIRST —
  // they're the ones that stop a prescription rather than qualify it.
  const allergyLines = allergyWarningsByDrug(
    meds.map((m) => m.drug),
    patient.allergies,
  );
  const guarded = meds.map((m, i) =>
    (allergyLines[i] ?? []).length > 0
      ? { ...m, warnings: [...allergyLines[i]!, ...m.warnings] }
      : m,
  );

  return {
    version: 'V1',
    dxLine: clean(note?.assessment),
    meds: guarded,
    investigations,
    adviceLines: dedupe(adviceLines),
    ...(followUp ? { followUp } : {}),
    allergies: patient.allergies,
    ...(vitalsLine(note) ? { vitalsLine: vitalsLine(note) } : {}),
  };
}

/**
 * Authority of a pad row's origin, highest wins a same-drug collision.
 * SPOKEN (2) — the doctor said it out loud.
 * DRAFTED (1) — Pass 2 inferred it from the consult.
 * CONTINUED (0) — carried from the patient's standing regimen.
 */
function sourceRank(row: RxMedRow): number {
  if (row.source === 'dictated') return 2;
  if (row.continued) return 0;
  return 1;
}

function splitPlan(plan: string): string[] {
  return plan
    .split(/[;\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function mentionsOrderOrMed(line: string, meds: RxMedRow[], inv: RxInvestigation[]): boolean {
  const l = line.toLowerCase();
  if (/review|follow.?up/.test(l)) return true; // handled as follow-up
  for (const m of meds) if (l.includes(drugKey(m.drug)) && drugKey(m.drug)) return true;
  for (const i of inv) {
    const w = i.name.toLowerCase().split(/\s+/)[0];
    if (w && w.length > 3 && l.includes(w)) return true;
  }
  return false;
}

function parseFollowUp(plan: string): { when: string } | null {
  const m = /(?:review|follow.?up)\s+(?:in\s+)?([^.;]+?)(?:\s+with[^.;]*)?[.;]?$/i.exec(plan);
  if (!m || !m[1]) return null;
  return { when: m[1].trim() };
}

function vitalsLine(note: MedicalEncounterNoteV1 | null): string | undefined {
  const v = note?.vitals;
  if (!v) return undefined;
  const parts: string[] = [];
  if (v.bpSystolic && v.bpDiastolic) parts.push(`BP ${v.bpSystolic}/${v.bpDiastolic}`);
  if (v.heartRateBpm) parts.push(`HR ${v.heartRateBpm}`);
  if (v.spo2Pct) parts.push(`SpO₂ ${v.spo2Pct}%`);
  if (v.tempCelsius) parts.push(`Temp ${v.tempCelsius}°C`);
  if (v.weightKg) parts.push(`Wt ${v.weightKg} kg`);
  return parts.length ? parts.join(' · ') : undefined;
}

function dedupe(xs: string[]): string[] {
  return [...new Set(xs.map((x) => x.trim()).filter(Boolean))];
}
