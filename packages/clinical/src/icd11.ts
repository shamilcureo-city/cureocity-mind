/**
 * ICD-11 diagnosis catalogue for the therapist vertical — PC5.
 *
 * SCOPE, AND WHY IT IS NOT THE WHOLE CLASSIFICATION. ICD-11 has ~85,000
 * entities across 28 chapters. Shipping all of them would be a multi-megabyte
 * bundle in which 99.9% of entries (fractures, arboviral fevers, obstetric
 * codes) are noise to a psychologist. This is Chapter 06 — Mental,
 * behavioural or neurodevelopmental disorders — at the level clinicians
 * actually record, plus the small set of adjacent codes that come up in
 * psychological practice (sleep-wake, and the QE psychosocial factors).
 *
 * Depressive disorders carry their full severity/remission children because
 * this product is built around PHQ-9 tracking and those distinctions drive
 * the reliable-change verdicts. Everything else sits at stem level; a
 * therapist needing a finer child can still type the code by hand — the
 * picker never blocks a free-text entry, which matters because the clinician,
 * not this list, is the authority.
 *
 * Labels are the WHO English titles, kept verbatim per WHO's terms. They are
 * NOT localised: ICD codes are recorded in English regardless of session
 * language (see CLAUDE.md § "Languages").
 *
 * Maintenance: this is a curated snapshot, not a synced mirror. If WHO
 * revises a title, fix it here — nothing derives these strings at runtime.
 */

export interface Icd11Entry {
  code: string;
  label: string;
}

export interface Icd11Block {
  /** The block heading shown as a group label in the picker. */
  block: string;
  entries: Icd11Entry[];
}

export const ICD11_CATALOG: Icd11Block[] = [
  {
    block: 'Neurodevelopmental disorders',
    entries: [
      { code: '6A00', label: 'Disorders of intellectual development' },
      { code: '6A01', label: 'Developmental speech or language disorders' },
      { code: '6A02', label: 'Autism spectrum disorder' },
      { code: '6A03', label: 'Developmental learning disorder' },
      { code: '6A04', label: 'Developmental motor coordination disorder' },
      { code: '6A05', label: 'Attention deficit hyperactivity disorder' },
      { code: '6A06', label: 'Stereotyped movement disorder' },
    ],
  },
  {
    block: 'Schizophrenia or other primary psychotic disorders',
    entries: [
      { code: '6A20', label: 'Schizophrenia' },
      { code: '6A21', label: 'Schizoaffective disorder' },
      { code: '6A22', label: 'Schizotypal disorder' },
      { code: '6A23', label: 'Acute and transient psychotic disorder' },
      { code: '6A24', label: 'Delusional disorder' },
    ],
  },
  {
    block: 'Mood disorders — bipolar',
    entries: [
      { code: '6A60', label: 'Bipolar type I disorder' },
      { code: '6A61', label: 'Bipolar type II disorder' },
      { code: '6A62', label: 'Cyclothymic disorder' },
    ],
  },
  {
    block: 'Mood disorders — depressive',
    entries: [
      { code: '6A70', label: 'Single episode depressive disorder' },
      { code: '6A70.0', label: 'Single episode depressive disorder, mild' },
      {
        code: '6A70.1',
        label: 'Single episode depressive disorder, moderate, without psychotic symptoms',
      },
      {
        code: '6A70.2',
        label: 'Single episode depressive disorder, moderate, with psychotic symptoms',
      },
      {
        code: '6A70.3',
        label: 'Single episode depressive disorder, severe, without psychotic symptoms',
      },
      {
        code: '6A70.4',
        label: 'Single episode depressive disorder, severe, with psychotic symptoms',
      },
      { code: '6A70.5', label: 'Single episode depressive disorder, unspecified severity' },
      {
        code: '6A70.6',
        label: 'Single episode depressive disorder, currently in partial remission',
      },
      { code: '6A70.7', label: 'Single episode depressive disorder, currently in full remission' },
      { code: '6A71', label: 'Recurrent depressive disorder' },
      { code: '6A71.0', label: 'Recurrent depressive disorder, current episode mild' },
      {
        code: '6A71.1',
        label:
          'Recurrent depressive disorder, current episode moderate, without psychotic symptoms',
      },
      {
        code: '6A71.2',
        label: 'Recurrent depressive disorder, current episode moderate, with psychotic symptoms',
      },
      {
        code: '6A71.3',
        label: 'Recurrent depressive disorder, current episode severe, without psychotic symptoms',
      },
      {
        code: '6A71.4',
        label: 'Recurrent depressive disorder, current episode severe, with psychotic symptoms',
      },
      { code: '6A71.5', label: 'Recurrent depressive disorder, currently in partial remission' },
      { code: '6A71.6', label: 'Recurrent depressive disorder, currently in full remission' },
      { code: '6A72', label: 'Dysthymic disorder' },
      { code: '6A73', label: 'Mixed depressive and anxiety disorder' },
    ],
  },
  {
    block: 'Anxiety or fear-related disorders',
    entries: [
      { code: '6B00', label: 'Generalised anxiety disorder' },
      { code: '6B01', label: 'Panic disorder' },
      { code: '6B02', label: 'Agoraphobia' },
      { code: '6B03', label: 'Specific phobia' },
      { code: '6B04', label: 'Social anxiety disorder' },
      { code: '6B05', label: 'Separation anxiety disorder' },
      { code: '6B06', label: 'Selective mutism' },
    ],
  },
  {
    block: 'Obsessive-compulsive or related disorders',
    entries: [
      { code: '6B20', label: 'Obsessive-compulsive disorder' },
      { code: '6B21', label: 'Body dysmorphic disorder' },
      { code: '6B22', label: 'Olfactory reference disorder' },
      { code: '6B23', label: 'Hypochondriasis' },
      { code: '6B24', label: 'Hoarding disorder' },
      { code: '6B25', label: 'Body-focused repetitive behaviour disorders' },
    ],
  },
  {
    block: 'Disorders specifically associated with stress',
    entries: [
      { code: '6B40', label: 'Post traumatic stress disorder' },
      { code: '6B41', label: 'Complex post traumatic stress disorder' },
      { code: '6B42', label: 'Prolonged grief disorder' },
      { code: '6B43', label: 'Adjustment disorder' },
      { code: '6B44', label: 'Reactive attachment disorder' },
      { code: '6B45', label: 'Disinhibited social engagement disorder' },
    ],
  },
  {
    block: 'Dissociative disorders',
    entries: [
      { code: '6B60', label: 'Dissociative neurological symptom disorder' },
      { code: '6B61', label: 'Dissociative amnesia' },
      { code: '6B62', label: 'Trance disorder' },
      { code: '6B63', label: 'Possession trance disorder' },
      { code: '6B64', label: 'Dissociative identity disorder' },
      { code: '6B65', label: 'Partial dissociative identity disorder' },
      { code: '6B66', label: 'Depersonalization-derealization disorder' },
    ],
  },
  {
    block: 'Feeding or eating disorders',
    entries: [
      { code: '6B80', label: 'Anorexia nervosa' },
      { code: '6B81', label: 'Bulimia nervosa' },
      { code: '6B82', label: 'Binge eating disorder' },
      { code: '6B83', label: 'Avoidant-restrictive food intake disorder' },
      { code: '6B84', label: 'Pica' },
      { code: '6B85', label: 'Rumination-regurgitation disorder' },
    ],
  },
  {
    block: 'Elimination disorders',
    entries: [
      { code: '6C00', label: 'Enuresis' },
      { code: '6C01', label: 'Encopresis' },
    ],
  },
  {
    block: 'Disorders of bodily distress or bodily experience',
    entries: [
      { code: '6C20', label: 'Bodily distress disorder' },
      { code: '6C21', label: 'Body integrity dysphoria' },
    ],
  },
  {
    block: 'Disorders due to substance use',
    entries: [
      { code: '6C40', label: 'Disorders due to use of alcohol' },
      { code: '6C41', label: 'Disorders due to use of cannabis' },
      { code: '6C43', label: 'Disorders due to use of opioids' },
      { code: '6C44', label: 'Disorders due to use of sedatives, hypnotics or anxiolytics' },
      { code: '6C45', label: 'Disorders due to use of cocaine' },
      { code: '6C46', label: 'Disorders due to use of stimulants including amphetamines' },
      { code: '6C48', label: 'Disorders due to use of caffeine' },
      { code: '6C49', label: 'Disorders due to use of hallucinogens' },
      { code: '6C4A', label: 'Disorders due to use of nicotine' },
      { code: '6C4B', label: 'Disorders due to use of volatile inhalants' },
      { code: '6C4C', label: 'Disorders due to use of MDMA or related drugs' },
      {
        code: '6C4D',
        label: 'Disorders due to use of dissociative drugs including ketamine or PCP',
      },
    ],
  },
  {
    block: 'Disorders due to addictive behaviours',
    entries: [
      { code: '6C50', label: 'Gambling disorder' },
      { code: '6C51', label: 'Gaming disorder' },
    ],
  },
  {
    block: 'Impulse control disorders',
    entries: [
      { code: '6C70', label: 'Pyromania' },
      { code: '6C71', label: 'Kleptomania' },
      { code: '6C72', label: 'Compulsive sexual behaviour disorder' },
      { code: '6C73', label: 'Intermittent explosive disorder' },
    ],
  },
  {
    block: 'Disruptive behaviour or dissocial disorders',
    entries: [
      { code: '6C90', label: 'Oppositional defiant disorder' },
      { code: '6C91', label: 'Conduct-dissocial disorder' },
    ],
  },
  {
    block: 'Personality disorders',
    entries: [
      { code: '6D10', label: 'Personality disorder' },
      { code: '6D10.0', label: 'Personality disorder, mild' },
      { code: '6D10.1', label: 'Personality disorder, moderate' },
      { code: '6D10.2', label: 'Personality disorder, severe' },
      { code: '6D11', label: 'Prominent personality traits or patterns' },
    ],
  },
  {
    block: 'Factitious disorders',
    entries: [
      { code: '6D50', label: 'Factitious disorder imposed on self' },
      { code: '6D51', label: 'Factitious disorder imposed on another' },
    ],
  },
  {
    block: 'Neurocognitive disorders',
    entries: [
      { code: '6D70', label: 'Delirium' },
      { code: '6D71', label: 'Mild neurocognitive disorder' },
      { code: '6D72', label: 'Amnestic disorder' },
      { code: '6D80', label: 'Dementia due to Alzheimer disease' },
      { code: '6D81', label: 'Dementia due to cerebrovascular disease' },
    ],
  },
  {
    block: 'Associated with pregnancy or the puerperium',
    entries: [
      {
        code: '6E20',
        label:
          'Mental or behavioural disorders associated with pregnancy, childbirth or the puerperium, without psychotic symptoms',
      },
      {
        code: '6E21',
        label:
          'Mental or behavioural disorders associated with pregnancy, childbirth or the puerperium, with psychotic symptoms',
      },
    ],
  },
  {
    block: 'Sleep-wake disorders (Chapter 07)',
    entries: [
      { code: '7A00', label: 'Chronic insomnia' },
      { code: '7A01', label: 'Short-term insomnia' },
      { code: '7A20', label: 'Chronic hypersomnolence' },
      { code: '7A41', label: 'Delayed sleep-wake phase disorder' },
      { code: '7B00', label: 'Nightmare disorder' },
    ],
  },
  {
    block: 'Psychosocial factors (Chapter 24)',
    entries: [
      { code: 'QE50', label: 'Problems associated with interpersonal interactions' },
      { code: 'QE60', label: 'Problems associated with employment or unemployment' },
      { code: 'QE70', label: 'Problems associated with housing or economic circumstances' },
      { code: 'QE80', label: 'Problems associated with the social environment' },
    ],
  },
];

/** Flat view — used for lookup and for filtering in the picker. */
export const ICD11_ENTRIES: readonly Icd11Entry[] = ICD11_CATALOG.flatMap((b) => b.entries);

const BY_CODE = new Map(ICD11_ENTRIES.map((e) => [e.code.toUpperCase(), e]));

/** The WHO title for a code, or null if it is outside this curated subset. */
export function icd11Label(code: string): string | null {
  return BY_CODE.get(code.trim().toUpperCase())?.label ?? null;
}

/**
 * Free-text search over code and label. Matches a code prefix or any
 * whitespace-separated term in the label, so "dep mod" finds the moderate
 * depressive entries and "6b0" finds the anxiety block.
 */
export function searchIcd11(query: string, limit = 60): Icd11Entry[] {
  const q = query.trim().toLowerCase();
  if (q === '') return ICD11_ENTRIES.slice(0, limit);
  const terms = q.split(/\s+/);
  const scored: { entry: Icd11Entry; score: number }[] = [];

  for (const entry of ICD11_ENTRIES) {
    const code = entry.code.toLowerCase();
    const label = entry.label.toLowerCase();
    // Every term must appear somewhere, so extra words narrow rather than widen.
    if (!terms.every((t) => code.includes(t) || label.includes(t))) continue;
    // Prefer exact/prefix code hits, then label-start hits, then the rest.
    const score = code === q ? 0 : code.startsWith(q) ? 1 : label.startsWith(q) ? 2 : 3;
    scored.push({ entry, score });
  }

  return scored
    .sort((a, b) => a.score - b.score || a.entry.code.localeCompare(b.entry.code))
    .slice(0, limit)
    .map((s) => s.entry);
}
