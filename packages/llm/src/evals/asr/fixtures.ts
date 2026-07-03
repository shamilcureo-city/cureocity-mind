/**
 * Sprint DS8 — the ASR benchmark seed set (Hinglish / Manglish / English).
 *
 * Each fixture is a code-mix OPD consult: the reference is the ground-truth
 * transcript (Indian patients code-mix, clinical keywords in English), with
 * the safety-critical drug names + key clinical terms called out so the
 * scorer can measure drug-name WER separately from overall WER.
 *
 * `mockHypothesis` is a REPRESENTATIVE engine output — a lightly-perturbed
 * reference — so `pnpm eval:asr` scores the harness deterministically in CI
 * with no audio + no creds. It is NOT a real transcription: the real
 * go/no-go number comes from running actor-recorded audio of these same
 * scripts through the live Vertex engine (see docs/asr-benchmark.md).
 * The point shipped here is the harness + the drug-name gate, ready to
 * consume real hypotheses the moment the recordings exist.
 */
export interface AsrFixture {
  id: string;
  domain: 'cardio' | 'endo' | 'gp';
  language: 'en' | 'hi' | 'ml';
  /** Ground-truth transcript (code-mixed; clinical terms in English). */
  reference: string;
  /** Safety-critical drug names that MUST survive transcription. */
  drugs: string[];
  /** Other clinical terms scored as medical-WER. */
  medicalTerms: string[];
  /** Stand-in engine output until actor-recorded audio replaces it. */
  mockHypothesis: string;
}

export const ASR_FIXTURES: AsrFixture[] = [
  // ---- Cardiology ---------------------------------------------------------
  {
    id: 'cardio-en-1',
    domain: 'cardio',
    language: 'en',
    reference:
      'I get chest pain when I climb the stairs and it goes to my left arm. Start aspirin seventy five and atorvastatin forty at night, and get an ECG and troponin today.',
    drugs: ['aspirin', 'atorvastatin'],
    medicalTerms: ['chest pain', 'left arm', 'ecg', 'troponin'],
    // Clean run: everything through, only a filler word dropped.
    mockHypothesis:
      'I get chest pain when I climb the stairs and it goes to my left arm. Start aspirin seventy five and atorvastatin forty at night and get an ECG and troponin today.',
  },
  {
    id: 'cardio-hi-1',
    domain: 'cardio',
    language: 'hi',
    reference:
      'Doctor sahab, seene mein dard hota hai jab main chalta hoon, aur pasina bhi aata hai. Aap telmisartan chalu karo aur ek ECG karwa lo, blood pressure bhi dekhna hai.',
    drugs: ['telmisartan'],
    medicalTerms: ['ecg', 'blood pressure'],
    // Code-mix drug name mangled — the exact failure the gate guards against.
    mockHypothesis:
      'Doctor sahab, seene mein dard hota hai jab main chalta hoon, aur pasina bhi aata hai. Aap telmisartion chalu karo aur ek ECG karwa lo, blood pressure bhi dekhna hai.',
  },
  {
    id: 'cardio-ml-1',
    domain: 'cardio',
    language: 'ml',
    reference:
      'Doctore, nെഞ്ചil വേദന und, kaiyilekku pokunnu. Aspirin kazhikkanam, atorvastatin raathri, blood pressure check cheyyanam.',
    drugs: ['aspirin', 'atorvastatin'],
    medicalTerms: ['blood pressure'],
    mockHypothesis:
      'Doctore, nെഞ്ചil വേദന und, kaiyilekku pokunnu. Aspirin kazhikkanam, atorvastatin raathri, blood pressure check cheyyanam.',
  },

  // ---- Endocrinology ------------------------------------------------------
  {
    id: 'endo-en-1',
    domain: 'endo',
    language: 'en',
    reference:
      'My sugar has been high and I feel thirsty all the time. Continue metformin five hundred twice daily, add insulin at night, and repeat the HbA1c after three months.',
    drugs: ['metformin', 'insulin'],
    medicalTerms: ['hba1c', 'thirsty'],
    mockHypothesis:
      'My sugar has been high and I feel thirsty all the time. Continue metformin five hundred twice daily, add insulin at night, and repeat the HbA1c after three months.',
  },
  {
    id: 'endo-hi-1',
    domain: 'endo',
    language: 'hi',
    reference:
      'Sugar bahut zyada rehta hai aur bhookh nahi lagti. Metformin do baar chalu rakho, HbA1c test karwa lo, aur diet control karna zaroori hai.',
    drugs: ['metformin'],
    medicalTerms: ['hba1c'],
    mockHypothesis:
      'Sugar bahut zyada rehta hai aur bhookh nahi lagti. Metformin do baar chalu rakho, HbA1c test karwa lo, aur diet control karna zaroori hai.',
  },
  {
    id: 'endo-ml-1',
    domain: 'endo',
    language: 'ml',
    reference:
      'Sugar valare koodi, ksheenam und. Metformin randu നേരം kazhikkanam, insulin raathri edukkanam, HbA1c repeat cheyyanam.',
    drugs: ['metformin', 'insulin'],
    medicalTerms: ['hba1c'],
    // Manglish drug slip: "insulin" heard as "insul".
    mockHypothesis:
      'Sugar valare koodi, ksheenam und. Metformin randu നേരം kazhikkanam, insul raathri edukkanam, HbA1c repeat cheyyanam.',
  },

  // ---- General practice ---------------------------------------------------
  {
    id: 'gp-en-1',
    domain: 'gp',
    language: 'en',
    reference:
      'I have had fever and a bad cough for four days. Take paracetamol five hundred when the fever is above one hundred, amoxicillin twice a day for five days, and rest.',
    drugs: ['paracetamol', 'amoxicillin'],
    medicalTerms: ['fever', 'cough'],
    mockHypothesis:
      'I have had fever and a bad cough for four days. Take paracetamol five hundred when the fever is above one hundred, amoxicillin twice a day for five days, and rest.',
  },
  {
    id: 'gp-hi-1',
    domain: 'gp',
    language: 'hi',
    reference:
      'Char din se bukhar aur khaansi hai, gala bhi kharab hai. Paracetamol le lena jab bukhar aaye, aur amoxicillin paanch din, khoob paani piyo.',
    drugs: ['paracetamol', 'amoxicillin'],
    medicalTerms: ['bukhar', 'khaansi'],
    mockHypothesis:
      'Char din se bukhar aur khaansi hai, gala bhi kharab hai. Paracetamol le lena jab bukhar aaye, aur amoxicillin paanch din, khoob paani piyo.',
  },
  {
    id: 'gp-ml-1',
    domain: 'gp',
    language: 'ml',
    reference:
      'Naalu divasamayi പനി und, chuma und. Paracetamol kazhikkanam പനി വന്നാൽ, amoxicillin anju divasam, നല്ല വിശ്രമം vേണം.',
    drugs: ['paracetamol', 'amoxicillin'],
    medicalTerms: ['chuma'],
    mockHypothesis:
      'Naalu divasamayi പനി und, chuma und. Paracetamol kazhikkanam പനി വന്നാൽ, amoxicillin anju divasam, നല്ല വിശ്രമം vേണം.',
  },
];
