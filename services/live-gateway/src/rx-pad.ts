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

/**
 * Sprint DS5 — deterministic Rx pad assembly.
 *
 * The pad is a structured re-presentation of what already flows through the
 * pipeline, gathered from three sources:
 *   - CONTINUED  — the patient's active meds (from context) auto-carry.
 *   - DRAFTED    — the Pass-2 medical note's medications (AI-suggested).
 *   - SPOKEN     — voice-command meds (the DV6.4 parser, the fast path).
 * Drafted + spoken rows land `pending` (the doctor confirms each);
 * continued rows land `confirmed`. Investigations come from the clinical
 * orders + spoken "order X" commands. Nothing auto-prescribes.
 *
 * Pure + DB-free so it unit-tests directly. `clean` strips the dev [mock] tag.
 */

const MOCK_TAG = /^\s*\[mock\]\s*/i;
function clean(s: string | undefined): string {
  return (s ?? '').replace(MOCK_TAG, '').trim();
}

/** Normalised drug key for dedup (first significant word, lowercased). */
function drugKey(drug: string): string {
  return clean(drug).toLowerCase().split(/\s+/)[0] ?? '';
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
  const seenDrugs = new Set<string>();
  const pushMed = (row: RxMedRow) => {
    const key = drugKey(row.drug);
    if (!key || seenDrugs.has(key)) return;
    seenDrugs.add(key);
    meds.push(row);
  };

  // 1. Continued meds from the patient's active list (confirmed).
  for (const active of patient.activeMeds) {
    if (!active.trim()) continue;
    pushMed({
      drug: active.trim(),
      continued: true,
      status: 'confirmed',
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

  return {
    version: 'V1',
    dxLine: clean(note?.assessment),
    meds,
    investigations,
    adviceLines: dedupe(adviceLines),
    ...(followUp ? { followUp } : {}),
    allergies: patient.allergies,
    ...(vitalsLine(note) ? { vitalsLine: vitalsLine(note) } : {}),
  };
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
