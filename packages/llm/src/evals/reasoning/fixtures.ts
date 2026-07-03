import type { PatientContext, Utterance } from '@cureocity/contracts';

/**
 * Sprint DS2 — the golden reasoning eval set (THE regression harness).
 *
 * 12 scripted consults across three domains (cardio / endo / GP) and three
 * language mixes (English, Hinglish, Manglish — the clinical keywords stay in
 * English, as real Indian patients code-mix). Each carries the expected
 * top-3 differential + the must-ask questions. `pnpm eval:reasoning` scores
 * top-3 recall + citation validity against a backend:
 *   - LLM_BACKEND=vertex → the real quality gate (≥10/12 primary in top-3).
 *   - mock (default)     → deterministic smoke run so the harness itself is
 *                          covered in CI with no creds.
 *
 * **Prompts never change without re-running this.**
 */
export interface ReasoningFixture {
  id: string;
  domain: 'cardio' | 'endo' | 'gp';
  language: 'en' | 'hi' | 'ml';
  specialty?: string;
  patient: PatientContext;
  utterances: Utterance[];
  /** Keywords expected among the top-3 differential labels (first = primary). */
  expectTop3: string[];
  /** Keywords expected among the ask-next questions. */
  expectAsk: string[];
}

function u(id: string, speaker: Utterance['speaker'], text: string, i: number): Utterance {
  return { id, speaker, text, tStartMs: i * 20_000, tEndMs: (i + 1) * 20_000 };
}

function patient(over: Partial<PatientContext> = {}): PatientContext {
  return { sex: 'unknown', knownConditions: [], activeMeds: [], allergies: [], ...over };
}

export const REASONING_FIXTURES: ReasoningFixture[] = [
  // ---- Cardiac (4) --------------------------------------------------------
  {
    id: 'cardio-en-1',
    domain: 'cardio',
    language: 'en',
    specialty: 'Cardiology',
    patient: patient({ age: 56, sex: 'male', knownConditions: ['hypertension'] }),
    utterances: [
      u('u1', 'doctor', 'What brings you in today?', 0),
      u(
        'u2',
        'patient',
        'I get chest pressure when I climb stairs, for two days now. It eases with rest.',
        1,
      ),
      u('u3', 'patient', 'No breathlessness when I sit still.', 2),
    ],
    expectTop3: ['angina', 'coronary syndrome'],
    expectAsk: ['radiate'],
  },
  {
    id: 'cardio-hi-1',
    domain: 'cardio',
    language: 'hi',
    specialty: 'Cardiology',
    patient: patient({ age: 61, sex: 'male' }),
    utterances: [
      u('u1', 'doctor', 'Kya problem ho rahi hai?', 0),
      u(
        'u2',
        'patient',
        'Do din se chest pain ho raha hai, chalne pe pressure lagta hai, rest se theek ho jaata hai.',
        1,
      ),
    ],
    expectTop3: ['angina', 'coronary syndrome'],
    expectAsk: ['radiate'],
  },
  {
    id: 'cardio-ml-1',
    domain: 'cardio',
    language: 'ml',
    specialty: 'Cardiology',
    patient: patient({ age: 58, sex: 'female' }),
    utterances: [
      u('u1', 'doctor', 'Enthaanu prashnam?', 0),
      u(
        'u2',
        'patient',
        'Randu divasamaayi chest pressure undu, exertion cheyyum bol koodi varunnu, rest edukkumbol kuranju.',
        1,
      ),
    ],
    expectTop3: ['angina', 'coronary syndrome'],
    expectAsk: ['radiate'],
  },
  {
    id: 'cardio-en-2',
    domain: 'cardio',
    language: 'en',
    specialty: 'General Medicine',
    patient: patient({ age: 49, sex: 'male', knownConditions: ['diabetes'] }),
    utterances: [
      u(
        'u1',
        'patient',
        'Doctor, I feel a heavy chest pain on exertion, comes and goes since yesterday.',
        0,
      ),
      u('u2', 'patient', 'It is like a pressure in the middle of my chest.', 1),
    ],
    expectTop3: ['angina', 'coronary syndrome'],
    expectAsk: ['radiate'],
  },

  // ---- Endocrine / diabetes (4) ------------------------------------------
  {
    id: 'endo-en-1',
    domain: 'endo',
    language: 'en',
    specialty: 'General Medicine',
    patient: patient({ age: 45, sex: 'male' }),
    utterances: [
      u('u1', 'doctor', 'Tell me what has been going on.', 0),
      u(
        'u2',
        'patient',
        'I have a lot of thirst and I am passing urine very often for two weeks, with some weight loss.',
        1,
      ),
      u('u3', 'patient', 'My random sugar at the pharmacy was high.', 2),
    ],
    expectTop3: ['diabetes'],
    expectAsk: ['nausea', 'vomiting'],
  },
  {
    id: 'endo-hi-1',
    domain: 'endo',
    language: 'hi',
    specialty: 'General Medicine',
    patient: patient({ age: 52, sex: 'female' }),
    utterances: [
      u(
        'u1',
        'patient',
        'Bahut zyada pyaas lagti hai aur baar baar urine aata hai, do hafte se. Sugar high aaya tha.',
        0,
      ),
      u('u2', 'patient', 'Thoda weight loss bhi hua hai.', 1),
    ],
    expectTop3: ['diabetes'],
    expectAsk: ['nausea', 'vomiting'],
  },
  {
    id: 'endo-ml-1',
    domain: 'endo',
    language: 'ml',
    specialty: 'General Medicine',
    patient: patient({ age: 47, sex: 'male' }),
    utterances: [
      u(
        'u1',
        'patient',
        'Ottiri thirst undu, urine idakkidey pokunnu, randu aazhcha aayi. Sugar high aayirunnu.',
        0,
      ),
      u('u2', 'patient', 'Weight loss um undu.', 1),
    ],
    expectTop3: ['diabetes'],
    expectAsk: ['nausea', 'vomiting'],
  },
  {
    id: 'endo-en-2',
    domain: 'endo',
    language: 'en',
    specialty: 'General Medicine',
    patient: patient({ age: 38, sex: 'female' }),
    utterances: [
      u(
        'u1',
        'patient',
        'I am always thirsty and urinating a lot, losing weight without trying.',
        0,
      ),
      u('u2', 'patient', 'My blood sugar reading was 260 last week.', 1),
    ],
    expectTop3: ['diabetes'],
    expectAsk: ['nausea', 'vomiting'],
  },

  // ---- General practice / infection (4) ----------------------------------
  {
    id: 'gp-en-1',
    domain: 'gp',
    language: 'en',
    specialty: 'General Medicine',
    patient: patient({ age: 29, sex: 'male' }),
    utterances: [
      u('u1', 'doctor', 'How are you feeling?', 0),
      u('u2', 'patient', 'I have had a fever for three days and a cough with phlegm.', 1),
      u('u3', 'patient', 'No breathlessness though.', 2),
    ],
    expectTop3: ['respiratory', 'pneumonia'],
    expectAsk: ['breathless'],
  },
  {
    id: 'gp-hi-1',
    domain: 'gp',
    language: 'hi',
    specialty: 'General Medicine',
    patient: patient({ age: 34, sex: 'female' }),
    utterances: [
      u('u1', 'patient', 'Teen din se fever hai aur cough aa rahi hai balgam ke saath.', 0),
      u('u2', 'patient', 'Saans phoolne ki problem nahi hai.', 1),
    ],
    expectTop3: ['respiratory', 'pneumonia'],
    expectAsk: ['breathless'],
  },
  {
    id: 'gp-ml-1',
    domain: 'gp',
    language: 'ml',
    specialty: 'General Medicine',
    patient: patient({ age: 41, sex: 'male' }),
    utterances: [
      u('u1', 'patient', 'Moonu divasamaayi fever undu, cough um balgam um undu.', 0),
      u('u2', 'patient', 'Breathlessness illa.', 1),
    ],
    expectTop3: ['respiratory', 'pneumonia'],
    expectAsk: ['breathless'],
  },
  {
    id: 'gp-en-2',
    domain: 'gp',
    language: 'en',
    specialty: 'General Medicine',
    patient: patient({ age: 26, sex: 'female' }),
    utterances: [
      u('u1', 'patient', 'Fever since three days, sore throat and a productive cough.', 0),
      u('u2', 'patient', 'I do not feel short of breath.', 1),
    ],
    expectTop3: ['respiratory', 'pneumonia'],
    expectAsk: ['breathless'],
  },
];
