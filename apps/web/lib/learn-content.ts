import type { GlossaryKey } from './clinical-glossary';

/**
 * Sprint 60 — the Learn & Help Center content registry.
 *
 * The single, typed source of truth for the in-app help destination. Not
 * a flat glossary page: groups → topics → sections, navigable and
 * searchable, written plain-first and India-first for therapists who are
 * new to software and to clinical shorthand.
 *
 * Deterministic source (no CMS, no LLM): version-controlled, instant, and
 * fully renderable in dev/CI. `glossaryRefs` is typed as `GlossaryKey[]`,
 * so a dangling glossary reference fails the TypeScript build. `related`
 * slugs + `tryIt` hrefs are author-maintained.
 */

export interface LearnSection {
  /** Plain section heading. */
  heading: string;
  /** Body paragraphs, in order. */
  body: string[];
  /** Optional concrete example, shown in a tinted box. */
  example?: string;
  /** Optional ordered steps. */
  steps?: string[];
}

export interface LearnTopic {
  /** URL slug — /app/learn/<slug>. */
  slug: string;
  /** The group this topic belongs to (see LEARN_GROUPS). */
  group: string;
  /** Big serif H1. */
  title: string;
  /** One-line promise of what you'll understand after reading. */
  lede: string;
  /** The bolded "in one sentence" summary up top. */
  oneLiner: string;
  sections: LearnSection[];
  /** Optional "Try it now →" deep link into the real product. */
  tryIt?: { href: string; label: string };
  /** Related topic slugs (rendered as see-also links). */
  related?: string[];
  /** Glossary terms this topic explains — typed, so refs can't dangle. */
  glossaryRefs?: GlossaryKey[];
}

export interface LearnGroup {
  key: string;
  title: string;
  blurb: string;
}

/** Groups, ordered the way a therapist's day flows — not how code is organised. */
export const LEARN_GROUPS: LearnGroup[] = [
  { key: 'getting-started', title: 'Getting started', blurb: 'From logged in to your first note.' },
  {
    key: 'recording',
    title: 'Recording a session',
    blurb: 'Before, during, and if something goes wrong.',
  },
  { key: 'notes', title: 'Your notes', blurb: 'What a note is, and how to edit and sign it.' },
  {
    key: 'ai',
    title: 'Understanding the AI',
    blurb: 'What it does, what it doesn’t, and who’s in charge.',
  },
  {
    key: 'progress',
    title: 'Measuring progress',
    blurb: 'Scores, real change, and the client’s journey.',
  },
  {
    key: 'sharing',
    title: 'Sharing with clients',
    blurb: 'What you can send, and what stays private.',
  },
  { key: 'safety', title: 'Safety', blurb: 'Safety flags and India crisis support.' },
  {
    key: 'privacy',
    title: 'Privacy & the law',
    blurb: 'How data is kept safe, and your client’s rights.',
  },
];

export const LEARN_TOPICS: LearnTopic[] = [
  // ---- Getting started ------------------------------------------------
  {
    slug: 'what-is-this',
    group: 'getting-started',
    title: 'What this app does',
    lede: 'The whole tool in two minutes.',
    oneLiner:
      'You record a session; the app writes the note and helps you think — you stay fully in charge.',
    sections: [
      {
        heading: 'The simple version',
        body: [
          'You press record during a session. When you finish, the app turns the conversation into a clear, written note for you to check.',
          'It also offers a second opinion — possible diagnoses, things still worth asking, and what might help — but nothing is saved to the record until you say so.',
        ],
      },
      {
        heading: 'What you still decide',
        body: [
          'Everything that matters. The app drafts; you read, change, and approve. You are the clinician — it is a helper that saves you typing and keeps your records tidy.',
        ],
      },
    ],
    tryIt: { href: '/app/today', label: 'Open Today' },
    related: ['add-a-client', 'record-a-session'],
  },
  {
    slug: 'add-a-client',
    group: 'getting-started',
    title: 'Add your first client',
    lede: 'The one thing to do before you record.',
    oneLiner: 'Capture a name and phone, confirm they agreed to recording, and you’re ready.',
    sections: [
      {
        heading: 'What you need',
        body: [
          'Just a name and a phone number to start. Email, languages and background can come later — the first session fills in most of it.',
        ],
        steps: [
          'Open Clients, then “New client”.',
          'Enter their name and phone number.',
          'Confirm they’ve agreed to being recorded and to AI helping with notes.',
        ],
      },
      {
        heading: 'Why consent comes first',
        body: [
          'Recording a session is only okay once the client has clearly agreed. It protects them, and it protects you.',
        ],
      },
    ],
    tryIt: { href: '/app/clients', label: 'Open Clients' },
    related: ['consent-and-recording', 'record-a-session'],
  },
  {
    slug: 'consent-and-recording',
    group: 'getting-started',
    title: 'Consent & recording',
    lede: 'Getting agreement, the right way.',
    oneLiner:
      'Always get a clear yes to recording before you start — and tell the client what it’s for.',
    sections: [
      {
        heading: 'What to say',
        body: [
          'Let the client know the session will be recorded, that it helps you write accurate notes, and that they can ask you to stop at any time. Wait for a clear yes.',
        ],
      },
      {
        heading: 'Why it matters here',
        body: [
          'Under India’s data-protection rules, you need the client’s informed agreement to handle their personal and health information. Honest, upfront consent keeps the trust intact too.',
        ],
      },
    ],
    related: ['privacy-dpdp', 'add-a-client'],
  },

  // ---- Recording ------------------------------------------------------
  {
    slug: 'record-a-session',
    group: 'recording',
    title: 'Recording a session',
    lede: 'How the capture works, start to finish.',
    oneLiner: 'Pick the client, start recording, and end when you’re done — the rest is automatic.',
    sections: [
      {
        heading: 'Before you start',
        body: [
          'From Record, choose who you’re with. The app reads their history and works out whether this is a first session, an ongoing one, or a review — you just confirm and begin.',
        ],
      },
      {
        heading: 'During and after',
        body: [
          'Record by phone or computer microphone in the room, or capture a video-call’s audio. The audio is saved as you go and survives a refresh, so a dropped connection won’t lose your work.',
          'When you end the session, the note begins writing itself. Head to the Notes tab to watch it appear.',
        ],
      },
    ],
    tryIt: { href: '/app', label: 'Open Record' },
    related: ['session-note', 'what-is-this'],
  },

  // ---- Your notes -----------------------------------------------------
  {
    slug: 'session-note',
    group: 'notes',
    title: 'What a session note is',
    lede: 'Your written record of the work.',
    oneLiner: 'A short, structured summary of the session — drafted for you, finished by you.',
    sections: [
      {
        heading: 'Why keep one',
        body: [
          'A clear note lets you pick up exactly where you left off next time, and it’s your professional record if your work is ever reviewed.',
          'The app drafts it from the recording so you’re not typing from memory at the end of a long day — but you read and fix it before it counts.',
        ],
      },
    ],
    tryIt: { href: '/app/clients', label: 'Pick a client' },
    related: ['soap-explained', 'editing-a-note', 'signing-a-note'],
    glossaryRefs: ['note.session'],
  },
  {
    slug: 'soap-explained',
    group: 'notes',
    title: 'The four parts of a note (SOAP)',
    lede: 'Plain words for a clinical habit.',
    oneLiner: 'SOAP just means: what they said, what you saw, what you make of it, and the plan.',
    sections: [
      {
        heading: 'The four parts',
        body: [
          'SOAP is a simple order for writing a note so nothing important is missed. In the app each part has a plain title; the clinical word sits underneath so you pick it up over time.',
        ],
        steps: [
          'What the client shared (Subjective) — their words, worries and how the week went.',
          'What you observed (Objective) — mood, manner, how they spoke.',
          'What you make of it (Assessment) — your read on what’s going on.',
          'The plan (Plan) — homework, focus for next time, and when you’ll meet.',
        ],
      },
      {
        heading: 'You don’t have to memorise it',
        body: [
          'The app labels each part for you. Over a few sessions the words become familiar — but the plain titles are always there.',
        ],
      },
    ],
    related: ['session-note', 'intake-note'],
    glossaryRefs: ['soap.summary', 'soap.subjective', 'soap.objective', 'soap.topics', 'soap.plan'],
  },
  {
    slug: 'intake-note',
    group: 'notes',
    title: 'The first-session record',
    lede: 'Why the first note looks different.',
    oneLiner: 'A first session captures the client’s story and background, not a plan yet.',
    sections: [
      {
        heading: 'What it covers',
        body: [
          'The first time you meet someone, you’re gathering their history — why they came, the story so far, family and life context, and how they seem today.',
          'There’s no treatment plan yet. That comes once you understand the picture, over the next session or two.',
        ],
      },
    ],
    related: ['soap-explained', 'clinical-brief'],
    glossaryRefs: [
      'note.intake',
      'intake.presentingConcerns',
      'intake.hpi',
      'intake.mentalStatusExam',
      'intake.workingHypothesis',
    ],
  },
  {
    slug: 'editing-a-note',
    group: 'notes',
    title: 'Editing & fixing a note',
    lede: 'It’s a draft until you say otherwise.',
    oneLiner: 'Change anything you like — by hand, or by telling the assistant what to fix.',
    sections: [
      {
        heading: 'Two ways to edit',
        body: [
          'You can edit the wording directly, or ask the assistant in plain language — “make it shorter”, “write the plan as bullet points”, “remove names”.',
          'The assistant only rewrites what’s there; it won’t invent new clinical content, and it leaves the safety and therapy-type fields untouched.',
        ],
      },
    ],
    related: ['session-note', 'signing-a-note'],
  },
  {
    slug: 'signing-a-note',
    group: 'notes',
    title: 'Signing a note (and why)',
    lede: 'What “sign off” actually does.',
    oneLiner: 'Signing locks the note as your final, official record — honestly and for good.',
    sections: [
      {
        heading: 'What happens when you sign',
        body: [
          'Once the note reads right, you sign it. That marks it as your final record for the session and lets you download it as a PDF.',
          'If you spot something later, you can add a correction — and every change is kept, so the record stays honest and complete.',
        ],
      },
    ],
    related: ['editing-a-note', 'sharing-with-clients'],
    glossaryRefs: ['action.sign'],
  },

  // ---- Understanding the AI ------------------------------------------
  {
    slug: 'the-ai-copilot',
    group: 'ai',
    title: 'What the AI does (and doesn’t)',
    lede: 'A helper, not a decision-maker.',
    oneLiner: 'The AI suggests; you decide. Nothing reaches the record without your okay.',
    sections: [
      {
        heading: 'What it’s good at',
        body: [
          'Turning a conversation into a tidy note, spotting themes, and offering a second opinion you can accept, edit, or reject.',
        ],
      },
      {
        heading: 'Where you must lead',
        body: [
          'It can be wrong, and it never carries clinical responsibility — you do. Always read its suggestions against what you actually saw and heard before acting on them.',
        ],
      },
    ],
    related: ['clinical-brief', 'session-note'],
    glossaryRefs: ['clinicalBrief'],
  },
  {
    slug: 'clinical-brief',
    group: 'ai',
    title: 'The clinical brief & diagnosis ideas',
    lede: 'The AI’s reading, explained.',
    oneLiner:
      'A second opinion: possible diagnoses with evidence, open questions, and what might help.',
    sections: [
      {
        heading: 'What’s inside',
        body: [
          'Possible diagnoses (with official ICD-11 codes and the exact lines they’re based on), the questions still worth asking, a short “why this person is struggling” picture, and suggested approaches.',
          'Each candidate shows how confident the AI is. Low confidence early on is normal — it’s a starting point, not a verdict.',
        ],
      },
      {
        heading: 'You confirm what’s true',
        body: [
          'Accept, edit, or reject each part. Only what you confirm is saved to the client’s record, building up over time.',
        ],
      },
    ],
    related: ['the-ai-copilot', 'measuring-progress'],
    glossaryRefs: [
      'diagnosis',
      'differential',
      'aiConfidence',
      'supportingEvidence',
      'assessmentGaps',
      'formulation',
      'treatmentPlan',
      'recommendedTherapies',
    ],
  },

  // ---- Measuring progress --------------------------------------------
  {
    slug: 'measuring-progress',
    group: 'progress',
    title: 'PHQ-9 & GAD-7 in plain words',
    lede: 'Putting a number on how someone’s doing.',
    oneLiner: 'Two short questionnaires that turn “how are you?” into a score you can track.',
    sections: [
      {
        heading: 'What they are',
        body: [
          'PHQ-9 asks nine questions about low mood; GAD-7 asks seven about anxiety. The client answers each on a small scale, and the app adds up a score.',
        ],
      },
      {
        heading: 'Why repeat them',
        body: [
          'The first score is your starting point. Repeating the questionnaire every few sessions shows whether things are genuinely improving — not just a good or bad day.',
        ],
        example:
          'A PHQ-9 falling from 18 to 9 over two months is a real, measurable improvement you can show the client.',
      },
    ],
    tryIt: { href: '/app/clients', label: 'Open a client' },
    related: ['the-journey', 'clinical-brief'],
    glossaryRefs: ['instruments', 'baseline', 'reliableChange'],
  },
  {
    slug: 'the-journey',
    group: 'progress',
    title: 'The client’s journey',
    lede: 'The whole arc, at a glance.',
    oneLiner: 'A simple map from first session to discharge, with what to do next.',
    sections: [
      {
        heading: 'What it shows',
        body: [
          'Where the client is in the work — first session, settling on a direction, active therapy, a review, or ready to finish — and a gentle nudge toward the next best step.',
          'It’s built from things you’ve already done: notes, confirmed diagnoses, plans and scores. Nothing extra to fill in.',
        ],
      },
    ],
    related: ['measuring-progress', 'sharing-with-clients'],
    glossaryRefs: ['diagnosisHistory'],
  },

  // ---- Sharing --------------------------------------------------------
  {
    slug: 'sharing-with-clients',
    group: 'sharing',
    title: 'What you can send a client',
    lede: 'Sharing, safely.',
    oneLiner:
      'Send a plain, client-friendly version over WhatsApp, email, or a private link — your notes stay private.',
    sections: [
      {
        heading: 'What you can share',
        body: [
          'Homework, a plain-language progress update, or reflection questions. The client sees a clean, friendly version — never your clinical notes.',
        ],
      },
      {
        heading: 'How it reaches them',
        body: [
          'Pick WhatsApp, email, or a private web link. Everything opens on a simple page made for the client; you choose exactly what goes out.',
        ],
      },
    ],
    tryIt: { href: '/app/clients', label: 'Pick a client' },
    related: ['signing-a-note', 'privacy-dpdp'],
    glossaryRefs: ['action.share'],
  },

  // ---- Safety ---------------------------------------------------------
  {
    slug: 'safety-flags',
    group: 'safety',
    title: 'Safety flags & crisis support',
    lede: 'When something serious shows up.',
    oneLiner:
      'If a session hints at risk, the app surfaces it first — with India helpline numbers.',
    sections: [
      {
        heading: 'What a safety flag means',
        body: [
          'The app noticed something that may point to risk — to the client or someone else — and pushed it to the top of the page so it isn’t missed. Please look into it before you sign off.',
        ],
      },
      {
        heading: 'India crisis helplines',
        body: ['Share these with a client in distress today:'],
        steps: [
          'iCall (TISS) — 9152987821 (Mon–Sat, 8am–10pm)',
          'Vandrevala Foundation — 1860-2662-345 (24×7)',
          'NIMHANS Helpline — 080-46110007 (24×7)',
        ],
      },
    ],
    related: ['clinical-brief'],
    glossaryRefs: ['riskFlags', 'crisisFlags'],
  },

  // ---- Privacy --------------------------------------------------------
  {
    slug: 'privacy-dpdp',
    group: 'privacy',
    title: 'How your data is kept safe',
    lede: 'Privacy, in plain terms.',
    oneLiner:
      'Client information is encrypted and handled under India’s data-protection rules (DPDP).',
    sections: [
      {
        heading: 'The basics',
        body: [
          'Client details are encrypted, access is limited to you, and the app is built around India’s Digital Personal Data Protection rules.',
          'Clients have rights over their data — to see it, correct it, or have it erased. Those requests are handled within the time the law allows.',
        ],
      },
    ],
    related: ['consent-and-recording', 'sharing-with-clients'],
  },
];

/** All topic slugs — for generateStaticParams + integrity checks. */
export const LEARN_SLUGS: string[] = LEARN_TOPICS.map((t) => t.slug);

export function topicBySlug(slug: string): LearnTopic | undefined {
  return LEARN_TOPICS.find((t) => t.slug === slug);
}

export function topicsByGroup(groupKey: string): LearnTopic[] {
  return LEARN_TOPICS.filter((t) => t.group === groupKey);
}

export function groupByKey(key: string): LearnGroup | undefined {
  return LEARN_GROUPS.find((g) => g.key === key);
}
