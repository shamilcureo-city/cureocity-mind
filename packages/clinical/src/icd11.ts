/**
 * ICD-11 diagnosis catalogue for the therapist vertical — PC5.
 *
 * SCOPE. This is Chapter 06 — Mental, behavioural or neurodevelopmental
 * disorders — aiming at completeness across its blocks, at the granularity
 * clinicians actually record, plus the adjacent codes psychological practice
 * uses (Chapter 07 sleep-wake, Chapter 24 QE psychosocial factors).
 *
 * It is NOT the whole classification. ICD-11 has ~85,000 entities across 28
 * chapters; the rest is fractures, infections and obstetrics — noise in a
 * psychology record, and megabytes of it. If a therapist needs a code outside
 * this catalogue they can still type it: the picker accepts free text, because
 * the clinician is the authority, not this list.
 *
 * REGULAR PATTERNS ARE GENERATED, NOT TYPED. The substance-use block (6C40–
 * 6C4H) repeats the same child pattern for every substance — ~150 entries
 * whose codes differ only in the stem. Hand-typing those is how a transposed
 * digit gets into a clinical record, so they are expanded from a table below.
 * Which children exist genuinely varies by substance (nicotine has no
 * intoxication code, caffeine no dependence), so that is declared per
 * substance rather than assumed uniform.
 *
 * Labels are the WHO English titles. They are NOT localised: ICD codes are
 * recorded in English regardless of session language (CLAUDE.md § Languages).
 *
 * Maintenance: a curated snapshot, not a synced mirror. If WHO revises a
 * title, fix it here — nothing derives these strings at runtime.
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

// ---------------------------------------------------------------------------
// Substance-use disorders (6C40–6C4H) — generated from the per-substance table
// ---------------------------------------------------------------------------

/**
 * The child suffixes shared across substances. `.5`–`.7` (induced delirium,
 * induced psychotic disorder, other induced disorders) only exist for the
 * substances that can produce them, so they are opted into per substance.
 */
const SUBSTANCE_CHILDREN = {
  harmfulEpisode: { suffix: '.0', label: (s: string) => `Episode of harmful use of ${s}` },
  harmfulPattern: { suffix: '.1', label: (s: string) => `Harmful pattern of use of ${s}` },
  dependence: { suffix: '.2', label: (s: string) => `${s} dependence` },
  intoxication: { suffix: '.3', label: (s: string) => `${s} intoxication` },
  withdrawal: { suffix: '.4', label: (s: string) => `${s} withdrawal` },
  delirium: { suffix: '.5', label: (s: string) => `${s}-induced delirium` },
  psychotic: { suffix: '.6', label: (s: string) => `${s}-induced psychotic disorder` },
  otherInduced: {
    suffix: '.7',
    label: (s: string) => `Certain specified ${s}-induced mental or behavioural disorders`,
  },
} as const;

type SubstanceChild = keyof typeof SUBSTANCE_CHILDREN;

/** The full pattern, used by most psychoactive substances. */
const FULL: SubstanceChild[] = [
  'harmfulEpisode',
  'harmfulPattern',
  'dependence',
  'intoxication',
  'withdrawal',
  'delirium',
  'psychotic',
  'otherInduced',
];

interface SubstanceSpec {
  stem: string;
  /** Title-case name for the stem entry, e.g. "Disorders due to use of alcohol". */
  stemLabel: string;
  /** How the substance reads inside a child label, e.g. "Alcohol", "alcohol". */
  subject: string;
  /** Lower-case form used in "…use of X" phrasings. */
  object: string;
  children: SubstanceChild[];
}

const SUBSTANCES: SubstanceSpec[] = [
  {
    stem: '6C40',
    stemLabel: 'Disorders due to use of alcohol',
    subject: 'Alcohol',
    object: 'alcohol',
    children: FULL,
  },
  {
    stem: '6C41',
    stemLabel: 'Disorders due to use of cannabis',
    subject: 'Cannabis',
    object: 'cannabis',
    children: FULL,
  },
  {
    stem: '6C42',
    stemLabel: 'Disorders due to use of synthetic cannabinoids',
    subject: 'Synthetic cannabinoid',
    object: 'synthetic cannabinoids',
    children: FULL,
  },
  {
    stem: '6C43',
    stemLabel: 'Disorders due to use of opioids',
    subject: 'Opioid',
    object: 'opioids',
    children: FULL,
  },
  {
    stem: '6C44',
    stemLabel: 'Disorders due to use of sedatives, hypnotics or anxiolytics',
    subject: 'Sedative, hypnotic or anxiolytic',
    object: 'sedatives, hypnotics or anxiolytics',
    children: FULL,
  },
  {
    stem: '6C45',
    stemLabel: 'Disorders due to use of cocaine',
    subject: 'Cocaine',
    object: 'cocaine',
    children: FULL,
  },
  {
    stem: '6C46',
    stemLabel: 'Disorders due to use of stimulants including amphetamines or methamphetamine',
    subject: 'Stimulant',
    object: 'stimulants including amphetamines or methamphetamine',
    children: FULL,
  },
  {
    stem: '6C47',
    stemLabel: 'Disorders due to use of synthetic cathinones',
    subject: 'Synthetic cathinone',
    object: 'synthetic cathinones',
    children: FULL,
  },
  {
    stem: '6C48',
    stemLabel: 'Disorders due to use of caffeine',
    subject: 'Caffeine',
    object: 'caffeine',
    // ICD-11 has no caffeine dependence category.
    children: ['harmfulEpisode', 'harmfulPattern', 'intoxication', 'withdrawal'],
  },
  {
    stem: '6C49',
    stemLabel: 'Disorders due to use of hallucinogens',
    subject: 'Hallucinogen',
    object: 'hallucinogens',
    children: FULL,
  },
  {
    stem: '6C4A',
    stemLabel: 'Disorders due to use of nicotine',
    subject: 'Nicotine',
    object: 'nicotine',
    // No nicotine intoxication category in ICD-11.
    children: ['harmfulEpisode', 'harmfulPattern', 'dependence', 'withdrawal'],
  },
  {
    stem: '6C4B',
    stemLabel: 'Disorders due to use of volatile inhalants',
    subject: 'Volatile inhalant',
    object: 'volatile inhalants',
    children: FULL,
  },
  {
    stem: '6C4C',
    stemLabel: 'Disorders due to use of MDMA or related drugs, including MDA',
    subject: 'MDMA or related drug',
    object: 'MDMA or related drugs, including MDA',
    children: FULL,
  },
  {
    stem: '6C4D',
    stemLabel: 'Disorders due to use of dissociative drugs including ketamine and PCP',
    subject: 'Dissociative drug including ketamine and PCP',
    object: 'dissociative drugs including ketamine and PCP',
    children: FULL,
  },
  {
    stem: '6C4E',
    stemLabel: 'Disorders due to use of other specified psychoactive substances',
    subject: 'Other specified psychoactive substance',
    object: 'other specified psychoactive substances',
    children: FULL,
  },
  {
    stem: '6C4F',
    stemLabel: 'Disorders due to use of multiple specified psychoactive substances',
    subject: 'Multiple specified psychoactive substances',
    object: 'multiple specified psychoactive substances',
    children: FULL,
  },
  {
    stem: '6C4G',
    stemLabel: 'Disorders due to use of unknown or unspecified psychoactive substances',
    subject: 'Unknown or unspecified psychoactive substance',
    object: 'unknown or unspecified psychoactive substances',
    children: FULL,
  },
  {
    stem: '6C4H',
    stemLabel: 'Disorders due to use of non-psychoactive substances',
    subject: 'Non-psychoactive substance',
    object: 'non-psychoactive substances',
    children: ['harmfulEpisode', 'harmfulPattern'],
  },
];

function expandSubstance(spec: SubstanceSpec): Icd11Entry[] {
  const out: Icd11Entry[] = [{ code: spec.stem, label: spec.stemLabel }];
  for (const key of spec.children) {
    const child = SUBSTANCE_CHILDREN[key];
    // "…use of X" phrasings take the lower-case object; the rest take the
    // title-case subject, so both read as WHO writes them.
    const usesObject = key === 'harmfulEpisode' || key === 'harmfulPattern';
    out.push({
      code: `${spec.stem}${child.suffix}`,
      label: child.label(usesObject ? spec.object : spec.subject),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------

export const ICD11_CATALOG: Icd11Block[] = [
  {
    block: 'Neurodevelopmental disorders',
    entries: [
      { code: '6A00', label: 'Disorders of intellectual development' },
      { code: '6A00.0', label: 'Disorder of intellectual development, mild' },
      { code: '6A00.1', label: 'Disorder of intellectual development, moderate' },
      { code: '6A00.2', label: 'Disorder of intellectual development, severe' },
      { code: '6A00.3', label: 'Disorder of intellectual development, profound' },
      { code: '6A00.4', label: 'Disorder of intellectual development, provisional' },
      { code: '6A01', label: 'Developmental speech or language disorders' },
      { code: '6A01.0', label: 'Developmental speech sound disorder' },
      { code: '6A01.1', label: 'Developmental speech fluency disorder' },
      { code: '6A01.2', label: 'Developmental language disorder' },
      { code: '6A02', label: 'Autism spectrum disorder' },
      {
        code: '6A02.0',
        label:
          'Autism spectrum disorder without disorder of intellectual development and with mild or no impairment of functional language',
      },
      {
        code: '6A02.1',
        label:
          'Autism spectrum disorder with disorder of intellectual development and with mild or no impairment of functional language',
      },
      {
        code: '6A02.2',
        label:
          'Autism spectrum disorder without disorder of intellectual development and with impaired functional language',
      },
      {
        code: '6A02.3',
        label:
          'Autism spectrum disorder with disorder of intellectual development and with impaired functional language',
      },
      {
        code: '6A02.4',
        label:
          'Autism spectrum disorder without disorder of intellectual development and with absence of functional language',
      },
      {
        code: '6A02.5',
        label:
          'Autism spectrum disorder with disorder of intellectual development and with absence of functional language',
      },
      { code: '6A03', label: 'Developmental learning disorder' },
      { code: '6A03.0', label: 'Developmental learning disorder with impairment in reading' },
      {
        code: '6A03.1',
        label: 'Developmental learning disorder with impairment in written expression',
      },
      { code: '6A03.2', label: 'Developmental learning disorder with impairment in mathematics' },
      { code: '6A03.3', label: 'Developmental learning disorder with other specified impairment' },
      { code: '6A04', label: 'Developmental motor coordination disorder' },
      { code: '6A05', label: 'Attention deficit hyperactivity disorder' },
      {
        code: '6A05.0',
        label: 'Attention deficit hyperactivity disorder, predominantly inattentive presentation',
      },
      {
        code: '6A05.1',
        label:
          'Attention deficit hyperactivity disorder, predominantly hyperactive-impulsive presentation',
      },
      {
        code: '6A05.2',
        label: 'Attention deficit hyperactivity disorder, combined presentation',
      },
      { code: '6A06', label: 'Stereotyped movement disorder' },
      { code: '6A0Y', label: 'Other specified neurodevelopmental disorders' },
      { code: '6A0Z', label: 'Neurodevelopmental disorders, unspecified' },
    ],
  },
  {
    block: 'Schizophrenia or other primary psychotic disorders',
    entries: [
      { code: '6A20', label: 'Schizophrenia' },
      { code: '6A20.0', label: 'Schizophrenia, first episode' },
      { code: '6A20.1', label: 'Schizophrenia, multiple episodes' },
      { code: '6A20.2', label: 'Schizophrenia, continuous' },
      { code: '6A21', label: 'Schizoaffective disorder' },
      { code: '6A21.0', label: 'Schizoaffective disorder, first episode' },
      { code: '6A21.1', label: 'Schizoaffective disorder, multiple episodes' },
      { code: '6A21.2', label: 'Schizoaffective disorder, continuous' },
      { code: '6A22', label: 'Schizotypal disorder' },
      { code: '6A23', label: 'Acute and transient psychotic disorder' },
      { code: '6A24', label: 'Delusional disorder' },
      { code: '6A25', label: 'Symptomatic manifestations of primary psychotic disorders' },
      { code: '6A25.0', label: 'Positive symptoms in primary psychotic disorders' },
      { code: '6A25.1', label: 'Negative symptoms in primary psychotic disorders' },
      { code: '6A25.2', label: 'Depressive mood symptoms in primary psychotic disorders' },
      { code: '6A25.3', label: 'Manic mood symptoms in primary psychotic disorders' },
      { code: '6A25.4', label: 'Psychomotor symptoms in primary psychotic disorders' },
      { code: '6A25.5', label: 'Cognitive symptoms in primary psychotic disorders' },
      { code: '6A2Y', label: 'Other specified primary psychotic disorder' },
      { code: '6A2Z', label: 'Schizophrenia or other primary psychotic disorders, unspecified' },
    ],
  },
  {
    block: 'Catatonia',
    entries: [
      { code: '6A40', label: 'Catatonia associated with another mental disorder' },
      {
        code: '6A41',
        label:
          'Catatonia induced by substances or medications, including withdrawal from substances or medications',
      },
      { code: '6A4Z', label: 'Catatonia, unspecified' },
    ],
  },
  {
    block: 'Mood disorders — bipolar or related',
    entries: [
      { code: '6A60', label: 'Bipolar type I disorder' },
      {
        code: '6A60.0',
        label: 'Bipolar type I disorder, current episode manic, without psychotic symptoms',
      },
      {
        code: '6A60.1',
        label: 'Bipolar type I disorder, current episode manic, with psychotic symptoms',
      },
      { code: '6A60.2', label: 'Bipolar type I disorder, current episode hypomanic' },
      { code: '6A60.3', label: 'Bipolar type I disorder, current episode depressive, mild' },
      {
        code: '6A60.4',
        label:
          'Bipolar type I disorder, current episode depressive, moderate, without psychotic symptoms',
      },
      {
        code: '6A60.5',
        label:
          'Bipolar type I disorder, current episode depressive, moderate, with psychotic symptoms',
      },
      {
        code: '6A60.6',
        label:
          'Bipolar type I disorder, current episode depressive, severe, without psychotic symptoms',
      },
      {
        code: '6A60.7',
        label:
          'Bipolar type I disorder, current episode depressive, severe, with psychotic symptoms',
      },
      {
        code: '6A60.8',
        label: 'Bipolar type I disorder, current episode depressive, unspecified severity',
      },
      {
        code: '6A60.9',
        label: 'Bipolar type I disorder, current episode mixed, without psychotic symptoms',
      },
      {
        code: '6A60.A',
        label: 'Bipolar type I disorder, current episode mixed, with psychotic symptoms',
      },
      { code: '6A60.B', label: 'Bipolar type I disorder, currently in partial remission' },
      { code: '6A60.C', label: 'Bipolar type I disorder, currently in full remission' },
      { code: '6A61', label: 'Bipolar type II disorder' },
      { code: '6A61.0', label: 'Bipolar type II disorder, current episode hypomanic' },
      { code: '6A61.1', label: 'Bipolar type II disorder, current episode depressive, mild' },
      {
        code: '6A61.2',
        label:
          'Bipolar type II disorder, current episode depressive, moderate, without psychotic symptoms',
      },
      {
        code: '6A61.3',
        label:
          'Bipolar type II disorder, current episode depressive, moderate, with psychotic symptoms',
      },
      {
        code: '6A61.4',
        label:
          'Bipolar type II disorder, current episode depressive, severe, without psychotic symptoms',
      },
      {
        code: '6A61.5',
        label:
          'Bipolar type II disorder, current episode depressive, severe, with psychotic symptoms',
      },
      { code: '6A61.8', label: 'Bipolar type II disorder, currently in partial remission' },
      { code: '6A61.9', label: 'Bipolar type II disorder, currently in full remission' },
      { code: '6A62', label: 'Cyclothymic disorder' },
      { code: '6A6Y', label: 'Other specified bipolar or related disorders' },
      { code: '6A6Z', label: 'Bipolar or related disorders, unspecified' },
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
      { code: '6A7Y', label: 'Other specified depressive disorders' },
      { code: '6A7Z', label: 'Depressive disorders, unspecified' },
      { code: '6A80', label: 'Symptomatic and course presentations for mood episodes' },
      { code: '6A80.0', label: 'Prominent anxiety symptoms in mood episodes' },
      { code: '6A80.1', label: 'Panic attacks in mood episodes' },
      { code: '6A80.2', label: 'Current depressive episode persistent' },
      { code: '6A80.3', label: 'Current depressive episode with melancholia' },
      { code: '6A80.4', label: 'Seasonal pattern of mood episode onset' },
      { code: '6A80.5', label: 'Rapid cycling' },
      { code: '6A80.6', label: 'Mood episode with perinatal onset' },
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
      { code: '6B0Y', label: 'Other specified anxiety or fear-related disorders' },
      { code: '6B0Z', label: 'Anxiety or fear-related disorders, unspecified' },
    ],
  },
  {
    block: 'Obsessive-compulsive or related disorders',
    entries: [
      { code: '6B20', label: 'Obsessive-compulsive disorder' },
      {
        code: '6B20.0',
        label: 'Obsessive-compulsive disorder with fair to good insight',
      },
      { code: '6B20.1', label: 'Obsessive-compulsive disorder with poor to absent insight' },
      { code: '6B21', label: 'Body dysmorphic disorder' },
      { code: '6B22', label: 'Olfactory reference disorder' },
      { code: '6B23', label: 'Hypochondriasis' },
      { code: '6B24', label: 'Hoarding disorder' },
      { code: '6B25', label: 'Body-focused repetitive behaviour disorders' },
      { code: '6B25.0', label: 'Trichotillomania' },
      { code: '6B25.1', label: 'Excoriation disorder' },
      { code: '6B2Y', label: 'Other specified obsessive-compulsive or related disorders' },
      { code: '6B2Z', label: 'Obsessive-compulsive or related disorders, unspecified' },
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
      { code: '6B4Y', label: 'Other specified disorders specifically associated with stress' },
      { code: '6B4Z', label: 'Disorders specifically associated with stress, unspecified' },
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
      { code: '6B6Y', label: 'Other specified dissociative disorders' },
      { code: '6B6Z', label: 'Dissociative disorders, unspecified' },
    ],
  },
  {
    block: 'Feeding or eating disorders',
    entries: [
      { code: '6B80', label: 'Anorexia nervosa' },
      {
        code: '6B80.0',
        label: 'Anorexia nervosa with significantly low body weight, restricting pattern',
      },
      {
        code: '6B80.1',
        label: 'Anorexia nervosa with significantly low body weight, binge-purge pattern',
      },
      { code: '6B80.2', label: 'Anorexia nervosa with dangerously low body weight' },
      { code: '6B80.3', label: 'Anorexia nervosa in recovery with normal body weight' },
      { code: '6B81', label: 'Bulimia nervosa' },
      { code: '6B82', label: 'Binge eating disorder' },
      { code: '6B83', label: 'Avoidant-restrictive food intake disorder' },
      { code: '6B84', label: 'Pica' },
      { code: '6B85', label: 'Rumination-regurgitation disorder' },
      { code: '6B8Y', label: 'Other specified feeding or eating disorders' },
      { code: '6B8Z', label: 'Feeding or eating disorders, unspecified' },
    ],
  },
  {
    block: 'Elimination disorders',
    entries: [
      { code: '6C00', label: 'Enuresis' },
      { code: '6C01', label: 'Encopresis' },
      { code: '6C0Z', label: 'Elimination disorders, unspecified' },
    ],
  },
  {
    block: 'Disorders of bodily distress or bodily experience',
    entries: [
      { code: '6C20', label: 'Bodily distress disorder' },
      { code: '6C20.0', label: 'Bodily distress disorder, mild' },
      { code: '6C20.1', label: 'Bodily distress disorder, moderate' },
      { code: '6C20.2', label: 'Bodily distress disorder, severe' },
      { code: '6C21', label: 'Body integrity dysphoria' },
      { code: '6C2Y', label: 'Other specified disorders of bodily distress or bodily experience' },
      { code: '6C2Z', label: 'Disorders of bodily distress or bodily experience, unspecified' },
    ],
  },
  // Substance-use blocks — expanded from the table above.
  ...SUBSTANCES.map((spec) => ({
    block: `Substance use — ${spec.object}`,
    entries: expandSubstance(spec),
  })),
  {
    block: 'Disorders due to addictive behaviours',
    entries: [
      { code: '6C50', label: 'Gambling disorder' },
      { code: '6C50.0', label: 'Gambling disorder, predominantly offline' },
      { code: '6C50.1', label: 'Gambling disorder, predominantly online' },
      { code: '6C51', label: 'Gaming disorder' },
      { code: '6C51.0', label: 'Gaming disorder, predominantly online' },
      { code: '6C51.1', label: 'Gaming disorder, predominantly offline' },
      { code: '6C5Y', label: 'Other specified disorders due to addictive behaviours' },
      { code: '6C5Z', label: 'Disorders due to addictive behaviours, unspecified' },
    ],
  },
  {
    block: 'Impulse control disorders',
    entries: [
      { code: '6C70', label: 'Pyromania' },
      { code: '6C71', label: 'Kleptomania' },
      { code: '6C72', label: 'Compulsive sexual behaviour disorder' },
      { code: '6C73', label: 'Intermittent explosive disorder' },
      { code: '6C7Y', label: 'Other specified impulse control disorders' },
      { code: '6C7Z', label: 'Impulse control disorders, unspecified' },
    ],
  },
  {
    block: 'Disruptive behaviour or dissocial disorders',
    entries: [
      { code: '6C90', label: 'Oppositional defiant disorder' },
      {
        code: '6C90.0',
        label: 'Oppositional defiant disorder with chronic irritability-anger',
      },
      {
        code: '6C90.1',
        label: 'Oppositional defiant disorder without chronic irritability-anger',
      },
      { code: '6C91', label: 'Conduct-dissocial disorder' },
      { code: '6C91.0', label: 'Conduct-dissocial disorder, childhood onset' },
      { code: '6C91.1', label: 'Conduct-dissocial disorder, adolescent onset' },
      { code: '6C9Y', label: 'Other specified disruptive behaviour or dissocial disorders' },
      { code: '6C9Z', label: 'Disruptive behaviour or dissocial disorders, unspecified' },
    ],
  },
  {
    block: 'Personality disorders and related traits',
    entries: [
      { code: '6D10', label: 'Personality disorder' },
      { code: '6D10.0', label: 'Mild personality disorder' },
      { code: '6D10.1', label: 'Moderate personality disorder' },
      { code: '6D10.2', label: 'Severe personality disorder' },
      { code: '6D10.Z', label: 'Personality disorder, severity unspecified' },
      { code: '6D11', label: 'Prominent personality traits or patterns' },
      {
        code: '6D11.0',
        label: 'Negative affectivity in personality disorder or personality difficulty',
      },
      { code: '6D11.1', label: 'Detachment in personality disorder or personality difficulty' },
      { code: '6D11.2', label: 'Dissociality in personality disorder or personality difficulty' },
      { code: '6D11.3', label: 'Disinhibition in personality disorder or personality difficulty' },
      { code: '6D11.4', label: 'Anankastia in personality disorder or personality difficulty' },
      { code: '6D11.5', label: 'Borderline pattern' },
    ],
  },
  {
    block: 'Paraphilic disorders',
    entries: [
      { code: '6D30', label: 'Exhibitionistic disorder' },
      { code: '6D31', label: 'Voyeuristic disorder' },
      { code: '6D32', label: 'Pedophilic disorder' },
      { code: '6D33', label: 'Coercive sexual sadism disorder' },
      { code: '6D34', label: 'Frotteuristic disorder' },
      { code: '6D35', label: 'Other paraphilic disorder involving non-consenting individuals' },
      {
        code: '6D36',
        label: 'Paraphilic disorder involving solitary behaviour or consenting individuals',
      },
      { code: '6D3Z', label: 'Paraphilic disorders, unspecified' },
    ],
  },
  {
    block: 'Factitious disorders',
    entries: [
      { code: '6D50', label: 'Factitious disorder imposed on self' },
      { code: '6D51', label: 'Factitious disorder imposed on another' },
      { code: '6D5Z', label: 'Factitious disorders, unspecified' },
    ],
  },
  {
    block: 'Neurocognitive disorders',
    entries: [
      { code: '6D70', label: 'Delirium' },
      { code: '6D71', label: 'Mild neurocognitive disorder' },
      { code: '6D72', label: 'Amnestic disorder' },
      { code: '6D80', label: 'Dementia due to Alzheimer disease' },
      { code: '6D80.0', label: 'Dementia due to Alzheimer disease with early onset' },
      { code: '6D80.1', label: 'Dementia due to Alzheimer disease with late onset' },
      { code: '6D81', label: 'Dementia due to cerebrovascular disease' },
      { code: '6D82', label: 'Dementia due to Lewy body disease' },
      { code: '6D83', label: 'Frontotemporal dementia' },
      { code: '6D84', label: 'Dementia due to psychoactive substances including medications' },
      { code: '6D85', label: 'Dementia due to diseases classified elsewhere' },
      { code: '6D86', label: 'Behavioural or psychological disturbances in dementia' },
      { code: '6D86.0', label: 'Psychotic symptoms in dementia' },
      { code: '6D86.1', label: 'Mood symptoms in dementia' },
      { code: '6D86.2', label: 'Anxiety symptoms in dementia' },
      { code: '6D86.3', label: 'Apathy in dementia' },
      { code: '6D86.4', label: 'Agitation or aggression in dementia' },
      { code: '6D86.5', label: 'Disinhibition in dementia' },
      { code: '6D8Z', label: 'Dementia, unknown or unspecified cause' },
    ],
  },
  {
    block: 'Associated with pregnancy, childbirth or the puerperium',
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
      {
        code: '6E2Z',
        label:
          'Mental or behavioural disorders associated with pregnancy, childbirth or the puerperium, unspecified',
      },
    ],
  },
  {
    block: 'Psychological factors and secondary syndromes',
    entries: [
      {
        code: '6E40',
        label:
          'Psychological or behavioural factors affecting disorders or diseases classified elsewhere',
      },
      { code: '6E60', label: 'Secondary neurodevelopmental syndrome' },
      { code: '6E61', label: 'Secondary psychotic syndrome' },
      { code: '6E62', label: 'Secondary mood syndrome' },
      { code: '6E63', label: 'Secondary anxiety syndrome' },
      { code: '6E64', label: 'Secondary obsessive-compulsive or related syndrome' },
      { code: '6E65', label: 'Secondary dissociative syndrome' },
      { code: '6E66', label: 'Secondary impulse control syndrome' },
      { code: '6E67', label: 'Secondary neurocognitive syndrome' },
      { code: '6E68', label: 'Secondary personality change' },
      { code: '6E69', label: 'Secondary catatonia syndrome' },
    ],
  },
  {
    block: 'Sleep-wake disorders (Chapter 07)',
    entries: [
      { code: '7A00', label: 'Chronic insomnia' },
      { code: '7A01', label: 'Short-term insomnia' },
      { code: '7A0Z', label: 'Insomnia disorders, unspecified' },
      { code: '7A20', label: 'Chronic hypersomnolence' },
      { code: '7A21', label: 'Short-term hypersomnolence' },
      { code: '7A40', label: 'Delayed sleep-wake phase disorder' },
      { code: '7A41', label: 'Advanced sleep-wake phase disorder' },
      { code: '7A42', label: 'Irregular sleep-wake rhythm disorder' },
      { code: '7A45', label: 'Circadian rhythm sleep-wake disorder, shift work type' },
      { code: '7A61', label: 'Sleep-related bruxism' },
      { code: '7B00', label: 'Disorders of arousal from non-REM sleep' },
      { code: '7B01', label: 'Sleepwalking disorder' },
      { code: '7B02', label: 'Sleep terrors' },
      { code: '7B20', label: 'Nightmare disorder' },
      { code: '7B21', label: 'REM sleep behaviour disorder' },
    ],
  },
  {
    block: 'Psychosocial factors (Chapter 24)',
    entries: [
      { code: 'QE50', label: 'Problems associated with interpersonal interactions' },
      { code: 'QE51', label: 'Problems associated with the primary support group' },
      { code: 'QE52', label: 'Problems associated with intimate relationships' },
      { code: 'QE60', label: 'Problems associated with employment or unemployment' },
      { code: 'QE70', label: 'Problems associated with housing or economic circumstances' },
      { code: 'QE80', label: 'Problems associated with the social environment' },
      { code: 'QE82', label: 'Problems associated with education' },
      { code: 'QE84', label: 'Problems associated with the legal system' },
      { code: 'QE8Z', label: 'Problems associated with psychosocial circumstances, unspecified' },
    ],
  },
];

/** Flat view — used for lookup and for filtering in the picker. */
export const ICD11_ENTRIES: readonly Icd11Entry[] = ICD11_CATALOG.flatMap((b) => b.entries);

const BY_CODE = new Map(ICD11_ENTRIES.map((e) => [e.code.toUpperCase(), e]));

/** The block a code belongs to, for the group heading in the picker. */
const BLOCK_BY_CODE = new Map(
  ICD11_CATALOG.flatMap((b) => b.entries.map((e) => [e.code.toUpperCase(), b.block] as const)),
);

/** The WHO title for a code, or null if it is outside this curated subset. */
export function icd11Label(code: string): string | null {
  return BY_CODE.get(code.trim().toUpperCase())?.label ?? null;
}

/** The block heading for a code, or null if it is outside the catalogue. */
export function icd11Block(code: string): string | null {
  return BLOCK_BY_CODE.get(code.trim().toUpperCase()) ?? null;
}

/**
 * Free-text search over code and label. Every term must match somewhere, so
 * extra words narrow rather than widen: "dep mod" finds the moderate
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
    if (!terms.every((t) => code.includes(t) || label.includes(t))) continue;
    const score =
      code === q ? 0 : label === q ? 1 : code.startsWith(q) ? 2 : label.startsWith(q) ? 3 : 4;
    scored.push({ entry, score });
  }

  // Within a tier, the shorter label wins: ICD-11 qualifies a category by
  // adding words to it, so "Panic disorder" is the plain diagnosis while
  // "Panic attacks in mood episodes" is the qualified one. Sorting by code
  // instead would rank purely on where WHO happened to put the code.
  return scored
    .sort(
      (a, b) =>
        a.score - b.score ||
        a.entry.label.length - b.entry.label.length ||
        a.entry.code.localeCompare(b.entry.code),
    )
    .slice(0, limit)
    .map((s) => s.entry);
}
