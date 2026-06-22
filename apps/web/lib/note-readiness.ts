import type { IntakeNoteV1, TherapyNoteV1 } from '@cureocity/contracts';

/**
 * Sprint 62 — "Is this note ready?" — a gentle, deterministic pre-sign
 * check.
 *
 * Pure functions over the note content (no LLM, no network). They return
 * friendly, non-blocking suggestions — never hard errors — so a new
 * therapist signs a more complete, more defensible note without ever
 * being told off. Each item carries a plain "why".
 *
 * Kept note-internal on purpose: it only reasons about the note in front
 * of the therapist, so it works the moment a draft exists.
 */

export interface ReadinessItem {
  /** The plain, calm observation. */
  label: string;
  /** Why it's worth a look. */
  hint: string;
}

/** Below this many non-space characters a section reads as "barely there". */
const THIN = 12;

function thin(value: string | undefined): boolean {
  return !value || value.trim().length < THIN;
}

/** Treatment (SOAP) note. */
export function checkTreatmentNoteReadiness(note: TherapyNoteV1): ReadinessItem[] {
  const items: ReadinessItem[] = [];

  if (thin(note.subjective) && thin(note.objective)) {
    items.push({
      label: 'There’s very little about what happened in the session',
      hint: 'A line on what the client shared, or how they seemed, makes the note make sense when you read it back.',
    });
  }
  if (thin(note.assessment)) {
    items.push({
      label: 'Your read on the session looks empty',
      hint: 'A sentence on what you make of it is the part only you can write.',
    });
  }
  if (thin(note.plan)) {
    items.push({
      label: 'The plan looks empty',
      hint: 'Note the next step — homework, what to focus on next time, or when you’ll meet again.',
    });
  }
  if (note.riskFlags.severity === 'high' || note.riskFlags.severity === 'critical') {
    items.push({
      label: 'This session has a safety flag',
      hint: 'Make sure you’ve looked into it, and that the note reflects what you did about it.',
    });
  }

  return items;
}

/** Intake (first-session) note. */
export function checkIntakeNoteReadiness(note: IntakeNoteV1): ReadinessItem[] {
  const items: ReadinessItem[] = [];

  if (thin(note.presentingConcerns)) {
    items.push({
      label: 'The reason they came looks empty',
      hint: 'A short line on what brought the client in anchors the whole record.',
    });
  }
  if (thin(note.historyOfPresentingIllness)) {
    items.push({
      label: 'The story so far is very short',
      hint: 'When it started and how it’s changed helps you and anyone reviewing the case later.',
    });
  }
  if (thin(note.mentalStatusExam)) {
    items.push({
      label: 'How they seemed today looks empty',
      hint: 'A quick snapshot of mood and manner becomes the baseline you compare against next time.',
    });
  }
  if (thin(note.immediatePlan)) {
    items.push({
      label: 'The next step looks empty',
      hint: 'Even just “follow-up in a week” tells you — and the client — what happens next.',
    });
  }
  if (note.riskFlags.severity === 'high' || note.riskFlags.severity === 'critical') {
    items.push({
      label: 'This session has a safety flag',
      hint: 'Make sure you’ve looked into it, and that the note reflects what you did about it.',
    });
  }

  return items;
}
