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
  /** Optional: slug of the Learn-Center topic that goes deeper. Reserved
   *  for S60 (the hub) — entries can carry it now; "Read more →" renders
   *  once the hub exists. */
  relatedTopic?: string;
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

  // ---- The clinical brief (the AI's reading of the session) ----------
  clinicalBrief: {
    plainTitle: "The AI's reading of the session",
    term: 'Clinical brief',
    what: "A second opinion from the AI — what it thinks might be going on, what's still unclear, and what could help. You accept, edit, or reject each part.",
    why: 'It is a helper, not the boss. You are the clinician; nothing is added to the record until you confirm it.',
  },
  initialAssessment: {
    plainTitle: 'First-session reading',
    term: 'Initial assessment',
    what: "The AI's first, wide read after an intake — a shortlist of possibilities to explore, not a decision. The aim is to narrow it over the next sessions.",
  },
  diagnosis: {
    plainTitle: 'Diagnosis ideas',
    term: 'Diagnosis candidates (ICD-11)',
    what: 'The conditions the AI thinks best fit what it heard, each with an official WHO code (ICD-11). One can be marked the main one.',
    why: 'Only what you confirm is saved to the client. Codes make your records consistent and shareable with other professionals.',
  },
  differential: {
    plainTitle: 'The shortlist of possibilities',
    term: 'Differential',
    what: 'Several conditions that could explain what you are seeing, kept side by side until you can rule some in and others out.',
    why: 'Holding a few options early — instead of jumping to one — is exactly how careful assessment works.',
  },
  aiConfidence: {
    plainTitle: 'How sure the AI is',
    term: 'AI confidence',
    what: 'A rough percentage for how strongly the evidence in this session points to that idea. Low early on is normal and expected.',
  },
  supportingEvidence: {
    plainTitle: 'The proof behind it',
    term: 'Supporting evidence',
    what: 'The exact lines from the session the AI is leaning on, with who said them and when — so you can check its reasoning yourself.',
  },
  assessmentGaps: {
    plainTitle: "What's still to find out",
    term: 'Assessment gaps',
    what: 'The questions still worth asking before you can be confident — each with a short reason why it matters.',
    why: 'These carry forward as a checklist, so nothing important quietly gets forgotten between sessions.',
  },
  formulation: {
    plainTitle: 'The bigger picture',
    term: 'Case formulation',
    what: "A short story of why this person is struggling — what set it off, what keeps it going, and their strengths. Not a label; the 'why' behind the work.",
    why: 'It turns a list of symptoms into a map you can actually plan treatment from.',
  },
  treatmentPlan: {
    plainTitle: 'The plan ahead',
    term: 'Treatment plan',
    what: 'The approach, the stages you expect to move through, and clear goals — each with a way to tell whether it is working.',
    why: 'A written plan you can revisit keeps the work focused and lets you show progress over time.',
  },
  recommendedTherapies: {
    plainTitle: 'Suggested approaches',
    term: 'Recommended therapies',
    what: 'Therapy methods that tend to help with this kind of difficulty, each with a short reason and the evidence behind it.',
  },
  crisisFlags: {
    plainTitle: 'Safety alerts',
    term: 'Crisis flags',
    what: 'Moments in the session that may point to risk — to the client or others. Shown first, with India helpline numbers, so they are never missed.',
    why: 'When something serious shows up, it deserves your attention before anything else on the page.',
  },

  // ---- Measuring progress --------------------------------------------
  instruments: {
    plainTitle: 'Quick questionnaires',
    term: 'Scored instruments (PHQ-9, GAD-7)',
    what: 'Short, well-tested checklists the client answers to put a number on how they are doing — PHQ-9 for low mood, GAD-7 for anxiety.',
    why: 'A number you can repeat each visit is the clearest way to see whether things are actually getting better.',
  },
  baseline: {
    plainTitle: 'The starting score',
    term: 'Baseline',
    what: 'The first score you record, near the start of the work. Every later score is compared against it.',
    why: 'Without a starting point there is nothing to measure change against — so capture it early.',
  },
  reliableChange: {
    plainTitle: 'Real, not random, change',
    term: 'Reliable change',
    what: "A drop big enough that it's very unlikely to be chance or a bad day — a genuine shift, judged against validated thresholds.",
  },
  diagnosisHistory: {
    plainTitle: 'How the diagnosis has changed',
    term: 'Diagnosis history',
    what: 'A timeline of the diagnoses you have confirmed for this client — the current one, and the earlier ones it replaced.',
    why: 'Seeing how your understanding evolved is good practice, and useful if the case is ever reviewed or handed over.',
  },
} satisfies Record<string, GlossaryEntry>;

export type GlossaryKey = keyof typeof CLINICAL_GLOSSARY;

/** Safe lookup — returns the entry for a known key. */
export function glossary(key: GlossaryKey): GlossaryEntry {
  return CLINICAL_GLOSSARY[key];
}
