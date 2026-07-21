/**
 * Cureocity Care — live-session cues (CP1, docs/CARE_PSYCHOLOGIST.md §3).
 *
 * The browser is the CLOCK AUTHORITY. A native-audio Gemini Live model has
 * no wall clock; left to guess, it "wraps up" early. So the client sends
 * short, SILENT text turns (`client_content`) that the model reads as
 * instructions, never aloud:
 *   1. the opening cue — the model speaks first (it stays mute until it
 *      receives an input turn);
 *   2. the time cues — a mid-session pacing nudge and, near the end, the ONE
 *      signal that authorises closing (prompt V4 makes the model wait for it).
 *
 * Client-only on purpose: these live in apps/web, not @cureocity/llm, so the
 * cue helpers never drag the server-side Gemini backends into the browser
 * bundle. The strings ARE the model's clock, so treat them as versioned copy
 * — terse, bracketed "[TIME SIGNAL …]", explicit that they are not spoken.
 * The client never mirrors them into the transcript.
 */

/** Sent once at setupComplete so the therapist opens the session first. */
export const CARE_OPENING_CUE =
  'You are now connected and they can hear you. Begin the session now — greet them first, softly and warmly, exactly as your instructions say. Do not wait for them to speak.';

export interface CareTimeCue {
  /** Fire as the countdown crosses down through this many seconds remaining. */
  atRemainingSec: number;
  text: string;
}

/**
 * The cue schedule, descending. Deliberately sparse — two signals — so the
 * model is paced, not nagged. The wind-down cue is the ONLY thing that tells
 * the model to close; without it (prompt V4) the model never closes on its own.
 */
export const CARE_TIME_CUES: readonly CareTimeCue[] = [
  {
    atRemainingSec: 300,
    text: '[TIME SIGNAL — do not read this aloud, never mention it] About five minutes remain. You should be in the main body of the work by now; do NOT start closing yet.',
  },
  {
    atRemainingSec: 120,
    text: '[TIME SIGNAL — do not read this aloud, never mention it] About two minutes remain. Begin closing NOW: reflect in a sentence or two what they found today, agree one small next step, and say a warm goodbye. Call end_session only after the goodbye.',
  },
];

/**
 * The cues whose threshold the countdown just crossed, going from `prev`
 * seconds remaining to `next`. Pure — the client calls it each tick.
 */
export function dueCareTimeCues(prevRemainingSec: number, nextRemainingSec: number): CareTimeCue[] {
  return CARE_TIME_CUES.filter(
    (c) => prevRemainingSec > c.atRemainingSec && nextRemainingSec <= c.atRemainingSec,
  );
}

/** Wrap cue text as the `client_content` frame the live wire expects. */
export function careCueFrame(text: string): string {
  return JSON.stringify({
    client_content: {
      turns: [{ role: 'user', parts: [{ text }] }],
      turn_complete: true,
    },
  });
}

/**
 * Below this many seconds remaining, a model-initiated `end_session` is
 * honoured; above it, the client declines (via tool_response) and the model
 * keeps going. Keeps a genuine end-of-session close working while blocking
 * the "guessed the time was up" early wrap. A user-tapped end always ends.
 */
export const CARE_END_SESSION_MIN_REMAINING_SEC = 180;
