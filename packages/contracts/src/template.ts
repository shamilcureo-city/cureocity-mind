import { z } from 'zod';
import { CuidSchema, IsoDateTimeSchema } from './common';

/**
 * NoteTemplate — therapist-owned customizable note structure. Each
 * template owns an ordered list of sections; downstream the Pass 2
 * system prompt is rewritten to ask the model to populate the named
 * sections from the transcript. Section ids are required for
 * downstream prompt construction and diff-tracking.
 */
export const TemplateSectionSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9_]+$/, 'lowercase letters / digits / underscores only'),
  title: z.string().min(1).max(200),
  hint: z.string().max(1000).optional(),
});
export type TemplateSection = z.infer<typeof TemplateSectionSchema>;

export const NoteTemplateSchema = z.object({
  id: CuidSchema,
  psychologistId: CuidSchema,
  name: z.string().min(1).max(200),
  description: z.string().nullable(),
  sections: z.array(TemplateSectionSchema).min(1).max(20),
  isDefault: z.boolean(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type NoteTemplate = z.infer<typeof NoteTemplateSchema>;

export const CreateNoteTemplateInputSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  sections: z.array(TemplateSectionSchema).min(1).max(20),
  isDefault: z.boolean().optional(),
});
export type CreateNoteTemplateInput = z.infer<typeof CreateNoteTemplateInputSchema>;

export const UpdateNoteTemplateInputSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).nullable().optional(),
    sections: z.array(TemplateSectionSchema).min(1).max(20).optional(),
    isDefault: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'at least one field must be provided' });
export type UpdateNoteTemplateInput = z.infer<typeof UpdateNoteTemplateInputSchema>;
