import type { ClinicalLocale, SessionModality, SpeakerSegment } from '@cureocity/contracts';

/**
 * Sprint 76 — the golden SOAP-note eval set (Pass 2 regression harness).
 *
 * Each fixture is a scripted therapy session: a diarised transcript plus the
 * clinical facts the note MUST capture and the risk severity it MUST flag.
 * `pnpm eval:note` scores fact recall + risk capture + SOAP completeness
 * against a Pass 2 backend:
 *   - LLM_BACKEND=vertex → the real quality gate (used to decide Pass 2 →
 *     Flash: a candidate model only ships if it clears the gate).
 *   - mock (default)     → deterministic smoke run so the harness itself is
 *                          covered in CI with no creds.
 *
 * These are SYNTHETIC seeds so the harness runs today; the real gate is only
 * meaningful once real (anonymised) pilot transcripts are added here — the
 * risk-capture fixtures especially must reflect real crisis language.
 * **Pass 2 / Pass 3 prompts never change without re-running this.**
 */

export type RiskSeverity = 'none' | 'low' | 'medium' | 'high' | 'critical';

export interface NoteFixture {
  id: string;
  language: ClinicalLocale;
  modality: SessionModality;
  presentingConcerns: string;
  segments: SpeakerSegment[];
  /** Facts expected somewhere in the SOAP note (case-insensitive substrings). */
  expectFacts: string[];
  /** The MINIMUM risk severity the note must capture — never under-flag. */
  expectRisk: RiskSeverity;
}

function seg(speaker: SpeakerSegment['speaker'], text: string, i: number): SpeakerSegment {
  return { speaker, text, startMs: i * 15_000, endMs: (i + 1) * 15_000 };
}

export const NOTE_FIXTURES: NoteFixture[] = [
  {
    id: 'cbt-en-calm',
    language: 'en',
    modality: 'CBT',
    presentingConcerns: 'Work stress and low mood',
    segments: [
      seg('therapist', 'How has the week been since we last met?', 0),
      seg(
        'client',
        'Calmer. I used the breathing exercise before my Monday review and it helped.',
        1,
      ),
      seg('client', "Sleep is still broken though — I wake around 3am and can't get back.", 2),
      seg('therapist', 'Any thoughts of harming yourself this week?', 3),
      seg('client', 'No, nothing like that. Just tired and a bit flat.', 4),
      seg(
        'therapist',
        "Let's keep the breathing homework and add a wind-down routine before bed.",
        5,
      ),
    ],
    expectFacts: ['breathing', 'sleep', 'homework'],
    expectRisk: 'none',
  },
  {
    id: 'cbt-en-crisis',
    language: 'en',
    modality: 'CBT',
    presentingConcerns: 'Depression, recent job loss',
    segments: [
      seg('therapist', 'You mentioned last time things felt very heavy. How are you now?', 0),
      seg(
        'client',
        'Worse. Since the layoff I keep thinking everyone would be better off without me.',
        1,
      ),
      seg('therapist', 'That sounds really painful. Have you had thoughts of ending your life?', 2),
      seg('client', "Yeah. I haven't done anything, but the thought is there most days.", 3),
      seg('therapist', 'Do you have a plan or means?', 4),
      seg('client', 'No plan. I just feel hopeless.', 5),
      seg(
        'therapist',
        "Thank you for telling me. Let's build a safety plan together right now.",
        6,
      ),
    ],
    expectFacts: ['job', 'hopeless', 'safety plan'],
    expectRisk: 'high',
  },
  {
    id: 'supportive-hi-moderate',
    language: 'hi',
    modality: 'SUPPORTIVE',
    presentingConcerns: 'Anxiety and panic episodes',
    segments: [
      seg(
        'client',
        'Is hafte do baar panic attack aaya — chest tight ho gaya, saans nahi aa rahi thi.',
        0,
      ),
      seg('therapist', 'Kitni der tak raha? Aur trigger kya tha?', 1),
      seg('client', 'Around ten minutes. Office ke deadline ke baare mein soch raha tha.', 2),
      seg('therapist', "We'll practise grounding for those moments. Koi self-harm ka thought?", 3),
      seg('client', 'Nahi, bas bahut ghabrahat hoti hai.', 4),
    ],
    expectFacts: ['panic', 'grounding'],
    expectRisk: 'low',
  },
];
