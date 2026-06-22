/**
 * Plain-language clinical glossary — Sprint 58.
 *
 * The single source of truth for "say it like a human" explanations of
 * the clinical terms the app puts in front of a therapist. Our pilot
 * users are often first-time software users who may not have trained on
 * SOAP, MSE, ICD-11 and the rest of the jargon. Every clinical term we
 * show should carry a gentle, optional "What's this?" written in plain,
 * warm English — so the product teaches as it works and never feels
 * intimidating.
 *
 * Conventions for the copy in this file:
 *  - `plainTitle` is what a non-clinical user reads FIRST (big heading).
 *  - `term` is the proper clinical word, shown small underneath, so the
 *    therapist still learns the real vocabulary over time.
 *  - `what` / `why` / `example` are 1-2 short sentences each. No jargon,
 *    no second clinical term inside the explanation of the first.
 *  - India-first voice: calm, respectful, never preachy.
 *
 * Rendered by `EduSection` / `InlineExplainer` in
 * `apps/web/components/app/EduHeading.tsx`.
 */

export interface GlossaryEntry {
  /** Big, friendly heading a non-clinical user reads first. */
  plainTitle: string;
  /** The proper clinical term, shown small as a subtitle so the
   *  therapist still picks up the vocabulary. Omit for plain-only labels. */
  term?: string;
  /** One or two plain sentences: what this section is. */
  what: string;
  /** Optional: why it matters / why it's worth capturing. */
  why?: string;
  /** Optional: one tiny, concrete example. */
  example?: string;
}

export const CLINICAL_GLOSSARY = {
  // ---- The session note, as a whole ----------------------------------
  'note.session': {
    plainTitle: 'Your session note',
    term: 'Progress note (SOAP)',
    what: 'A short written record of what happened in this session — drafted for you from the recording. You read it, fix anything that is off, and save it.',
    why: 'It is your professional record of the work. A clear note helps you pick up exactly where you left off next time, and protects you if your records are ever reviewed.',
  },
  'note.intake': {
    plainTitle: 'First-session record',
    term: 'Intake note',
    what: 'The fuller write-up you make the first time you meet a client — their story, background, and how they seem right now.',
    why: 'It is the foundation of the whole case. Everything you plan later refers back to it.',
  },

  // ---- SOAP, the four parts of a progress note -----------------------
  'soap.summary': {
    plainTitle: 'What the client shared',
    term: 'Subjective + Objective',
    what: 'In their words: what they came with, how the week went, what is on their mind — together with what you noticed yourself (mood, body language, how they spoke).',
    example:
      '"Said work stress is easing. Looked more relaxed, made eye contact, smiled a few times."',
  },
  'soap.subjective': {
    plainTitle: 'What the client told you',
    term: 'Subjective (the “S” in SOAP)',
    what: 'The session from the client’s side — their feelings, worries and what they reported, in their own words.',
  },
  'soap.objective': {
    plainTitle: 'What you observed',
    term: 'Objective (the “O” in SOAP)',
    what: 'What you noticed with your own eyes and ears — appearance, mood, how they spoke and behaved. The facts, not your interpretation yet.',
  },
  'soap.topics': {
    plainTitle: 'What you make of it',
    term: 'Assessment (the “A” in SOAP)',
    what: 'Your professional read on what is going on — the main themes of the session and how the client is doing.',
    why: 'This is the part that is truly yours. The draft gives you a starting point; your judgement is what matters.',
  },
  'soap.plan': {
    plainTitle: 'The plan',
    term: 'Plan (the “P” in SOAP)',
    what: 'What happens next — homework, what to focus on next time, any referrals, and when you will meet again.',
  },

  // ---- Intake-note sections ------------------------------------------
  'intake.presentingConcerns': {
    plainTitle: 'Why they came',
    term: 'Presenting concerns',
    what: 'The main problem or reason the client reached out, in simple terms.',
  },
  'intake.hpi': {
    plainTitle: 'The story so far',
    term: 'History of present illness',
    what: 'How this difficulty started and changed over time — when it began, what makes it better or worse, how bad it gets.',
  },
  'intake.pastPsychiatricHistory': {
    plainTitle: 'Past mental-health care',
    term: 'Past psychiatric history',
    what: 'Any earlier therapy, counselling, medication or hospital care for emotional or mental-health reasons.',
  },
  'intake.familyHistory': {
    plainTitle: 'Family background',
    term: 'Family history',
    what: 'Relevant health and mental-health patterns in the family that may matter for this client.',
  },
  'intake.socialHistory': {
    plainTitle: 'Life & relationships',
    term: 'Social history',
    what: 'The everyday context — work or studies, family, friendships, living situation and important life events.',
  },
  'intake.mentalStatusExam': {
    plainTitle: 'How they seemed today',
    term: 'Mental status exam (MSE)',
    what: 'A snapshot of the client in the room — how they looked, their mood, the way they spoke, and how clear their thinking was.',
    why: 'It is a baseline. Comparing it session to session is one of the clearest ways to see change.',
  },
  'intake.workingHypothesis': {
    plainTitle: 'Your early thinking',
    term: 'Working hypothesis',
    what: 'A first, gentle guess at what may be going on — not a final diagnosis, just a direction to explore.',
    why: 'It is meant to change as you learn more. Holding it lightly is good practice.',
  },
  'intake.immediatePlan': {
    plainTitle: 'What happens next',
    term: 'Immediate plan',
    what: 'The very next steps — usually a follow-up session, a questionnaire to fill, or a referral.',
  },

  // ---- Clinical brief / supporting concepts --------------------------
  modality: {
    plainTitle: 'Therapy approach',
    term: 'Modality',
    what: 'The style of therapy you are using with this client — for example CBT, EMDR, or supportive counselling.',
  },
  riskFlags: {
    plainTitle: 'Safety check',
    term: 'Risk flags',
    what: 'A note of anything that suggests the client could be at risk — to themselves or others — and how serious it looks.',
    why: 'Surfaced up top so it is never missed. If something looks high, it deserves your attention before anything else.',
  },
  phaseHints: {
    plainTitle: 'Where this sits in the work',
    term: 'Therapy phase',
    what: 'A rough guess at which stage of therapy this session belongs to — for example early-stage building trust, or later-stage practising skills.',
  },
  transcript: {
    plainTitle: 'The recording, in words',
    term: 'Transcript',
    what: 'The full conversation written out, with who said what. Handy if you want to check the exact words behind the note.',
  },

  // ---- Actions -------------------------------------------------------
  'action.sign': {
    plainTitle: 'Saving the note for good',
    term: 'Sign-off',
    what: 'When the note reads right, you "sign" it. That locks it as your final, official record for this session.',
    why: 'You can still add a follow-up correction later, and every change is kept — so your record stays honest and complete.',
  },
  'action.share': {
    plainTitle: 'Sending something to the client',
    term: 'Patient share',
    what: 'Share a plain, client-friendly version — homework, a summary or a progress update — over WhatsApp, email or a private link.',
    why: 'The client only ever sees what you choose to send. Your clinical notes stay private to you.',
  },
} satisfies Record<string, GlossaryEntry>;

export type GlossaryKey = keyof typeof CLINICAL_GLOSSARY;

/** Safe lookup — returns the entry for a known key. */
export function glossary(key: GlossaryKey): GlossaryEntry {
  return CLINICAL_GLOSSARY[key];
}
