import { z } from 'zod';
import { MedicalEvidenceFieldSchema, RxPadAddMedSchema } from '@cureocity/contracts';

const title = z.string().trim().min(1).max(80);
export const ScribeNarrativeFieldSchema = z.enum(['chiefComplaint', 'hpi', 'assessment', 'plan']);
export type ScribeNarrativeField = z.infer<typeof ScribeNarrativeFieldSchema>;
export const ScribeFavoriteItemSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('medication'),
      title,
      med: RxPadAddMedSchema.shape.med.omit({ continued: true }).strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal('investigation'),
      title,
      name: z.string().trim().min(1).max(200),
      rationale: z.string().trim().max(300).optional(),
    })
    .strict(),
  z.object({ type: z.literal('advice'), title, text: z.string().trim().min(1).max(300) }).strict(),
]);
export type ScribeFavoriteItem = z.infer<typeof ScribeFavoriteItemSchema>;
export const ScribeShortcutSchema = z.discriminatedUnion('type', [
  ...ScribeFavoriteItemSchema.options,
  z
    .object({
      type: z.literal('set'),
      title,
      items: z.array(ScribeFavoriteItemSchema).min(1).max(5),
    })
    .strict(),
  z
    .object({
      type: z.literal('phrase'),
      title,
      field: ScribeNarrativeFieldSchema,
      text: z.string().trim().min(1).max(4_000),
    })
    .strict(),
]);
export type ScribeShortcut = z.infer<typeof ScribeShortcutSchema>;

export function shortcutRequiresPrescribing(shortcut: ScribeShortcut): boolean {
  return (
    shortcut.type === 'medication' ||
    (shortcut.type === 'set' && shortcut.items.some((item) => item.type === 'medication'))
  );
}

export const SCRIBE_NOTE_FIELDS = [
  'chiefComplaint',
  'hpi',
  'reviewOfSystems',
  'physicalExam',
  'vitals',
  'assessment',
  'plan',
] as const;
export const SCRIBE_NOTE_LABELS = {
  chiefComplaint: 'Chief complaint',
  hpi: 'History of present illness',
  reviewOfSystems: 'Review of systems',
  physicalExam: 'Physical exam',
  vitals: 'Vitals',
  assessment: 'Assessment',
  plan: 'Plan',
};
const label = z.string().trim().min(1).max(64);
export const ScribeNoteProfileSchema = z
  .object({
    order: z
      .array(MedicalEvidenceFieldSchema)
      .length(7)
      .refine((items) => new Set(items).size === 7, 'Include every section once.'),
    labels: z
      .object({
        chiefComplaint: label,
        hpi: label,
        reviewOfSystems: label,
        physicalExam: label,
        vitals: label,
        assessment: label,
        plan: label,
      })
      .strict(),
    density: z.enum(['concise', 'detailed']),
  })
  .strict();
export const ScribeNoteStyleSchema = z
  .object({ firstVisit: ScribeNoteProfileSchema, followUp: ScribeNoteProfileSchema })
  .strict();
export type ScribeNoteProfile = z.infer<typeof ScribeNoteProfileSchema>;
export type ScribeNoteStyle = z.infer<typeof ScribeNoteStyleSchema>;
export const DEFAULT_SCRIBE_NOTE_STYLE: ScribeNoteStyle = {
  firstVisit: {
    order: [...SCRIBE_NOTE_FIELDS],
    labels: { ...SCRIBE_NOTE_LABELS },
    density: 'detailed',
  },
  followUp: {
    order: [...SCRIBE_NOTE_FIELDS],
    labels: { ...SCRIBE_NOTE_LABELS },
    density: 'concise',
  },
};

const recordMeta = {
  id: z.string(),
  revision: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
};
export const ScribeShortcutRecordSchema = z.object({ ...recordMeta, body: ScribeShortcutSchema });
export type ScribeShortcutRecord = z.infer<typeof ScribeShortcutRecordSchema>;
export const ScribeShortcutsResponseSchema = z.object({
  records: z.array(ScribeShortcutRecordSchema),
});
export const ScribeNoteStyleResponseSchema = z.object({
  record: z.object({ ...recordMeta, body: ScribeNoteStyleSchema }).nullable(),
});
export const ScribeShortcutUpdateSchema = z
  .object({ revision: z.number().int().positive(), body: ScribeShortcutSchema })
  .strict();
export const ScribeRecordDeleteSchema = z
  .object({ revision: z.number().int().positive() })
  .strict();
export const ScribeNoteStyleUpdateSchema = z
  .object({ revision: z.number().int().nonnegative(), body: ScribeNoteStyleSchema })
  .strict();
