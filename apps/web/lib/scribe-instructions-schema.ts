import { z } from 'zod';

export const InstructionLanguageSchema = z.enum(['source', 'en', 'ml', 'hi', 'ta', 'bn']);
export const INSTRUCTION_LANGUAGES = {
  source: 'As signed (no translation)',
  en: 'English',
  ml: 'Malayalam',
  hi: 'Hindi',
  ta: 'Tamil',
  bn: 'Bengali',
} as const;
export const InstructionLineSchema = z.object({
  id: z.string().min(1).max(80),
  kind: z.enum(['medication', 'advice', 'investigation', 'followup']),
  source: z.string().min(1).max(2000),
  text: z.string().trim().min(1).max(2000),
});
export const InstructionsBodySchema = z.object({
  version: z.literal(1),
  status: z.enum(['draft', 'reviewed']),
  language: InstructionLanguageSchema,
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  noteId: z.string().min(1),
  signedAt: z.string().datetime(),
  lines: z.array(InstructionLineSchema).min(1).max(100),
  clinicalReviewed: z.boolean(),
  languageReviewed: z.boolean(),
  reviewedAt: z.string().datetime().nullable(),
  reviewedBy: z.string().nullable(),
});
export const InstructionsReviewInputSchema = z
  .object({
    revision: z.number().int().positive(),
    lines: z
      .array(
        z.object({ id: z.string().max(80), text: z.string().trim().min(1).max(2000) }).strict(),
      )
      .min(1)
      .max(100),
    clinicalReviewed: z.literal(true),
    languageReviewed: z.literal(true),
  })
  .strict();
export type InstructionsBody = z.infer<typeof InstructionsBodySchema>;
export type InstructionLine = z.infer<typeof InstructionLineSchema>;
export type InstructionLanguage = z.infer<typeof InstructionLanguageSchema>;

/** Mechanical guard only; clinical equivalence still requires an explicit doctor review. */
export function instructionWordingPreservesFacts(line: InstructionLine, text: string): boolean {
  // Rx prose contains non-numeric clinical facts (OD/BD, before food, oral/topical).
  // Neither a translator nor this document editor is allowed to rewrite any of it.
  if (line.kind === 'medication') return text === line.source;
  const numbers = (value: string) => (value.match(/\d+(?:[.,]\d+)*/g) ?? []).join('|');
  if (numbers(line.source) !== numbers(text)) return false;
  const units = (value: string) =>
    (
      value.match(/\d+(?:[.,]\d+)*\s*(?:mcg|µg|mg|kg|g|ml|mL|L|IU|units?)(?:\/[a-zA-Z]+)?\b/gi) ??
      []
    )
      .map((dose) => dose.replace(/\s/g, '').toLowerCase())
      .join('|');
  if (units(line.source) !== units(text)) return false;
  return true;
}

export function reviewedInstructionLines(
  body: InstructionsBody,
  edits: Array<{ id: string; text: string }>,
): InstructionLine[] | null {
  if (
    edits.length !== body.lines.length ||
    new Set(edits.map((line) => line.id)).size !== edits.length
  )
    return null;
  const rows = body.lines.map((line) => {
    const edit = edits.find((row) => row.id === line.id);
    return edit && instructionWordingPreservesFacts(line, edit.text)
      ? { ...line, text: edit.text }
      : null;
  });
  return rows.every((line): line is InstructionLine => line !== null) ? rows : null;
}
