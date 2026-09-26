import {
  MedicalEncounterNoteV1Schema,
  type DifferentialDiagnosisV1,
  type MedicalEncounterNoteV1,
} from '@cureocity/contracts';
import { z } from 'zod';
import { canonicalJson } from './sign-note-payload';

/** This worksheet is neither a signed clinical note nor a verified billing claim. */
export const SCRIBE_CODING_MAX_ENTRIES = 30;
export const ScribeCodingSystemSchema = z.enum(['ICD10_WHO', 'ICD10_CM']);
export type ScribeCodingSystem = z.infer<typeof ScribeCodingSystemSchema>;

const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime({ offset: true });
// Deliberately only a broad shape check. No catalogue, release or billability is verified.
const codeShape = /^[A-Z][0-9][A-Z0-9](?:\.[A-Z0-9]{1,4})?$/;

export const ScribeCodingEntrySchema = z
  .object({
    id: identifier,
    origin: z.enum(['manual', 'ai_suggestion']),
    sourceSuggestionId: identifier.optional(),
    code: z.string().trim().max(24),
    label: z.string().trim().max(500),
    system: ScribeCodingSystemSchema.nullable(),
    release: z.string().trim().max(120),
    decision: z.enum(['pending', 'include', 'exclude']),
    documentation: z.string().trim().max(4_000),
  })
  .strict()
  .superRefine((entry, ctx) => {
    if (entry.decision !== 'include') return;
    for (const field of ['system', 'release', 'code', 'label', 'documentation'] as const) {
      if (!entry[field])
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `Included entries require ${field}.`,
        });
    }
    if (entry.code && !codeShape.test(entry.code))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['code'],
        message: 'Use an uppercase ICD-10-shaped code. Syntax is not catalogue verification.',
      });
  });
export type ScribeCodingEntry = z.infer<typeof ScribeCodingEntrySchema>;

export const ScribeCodingWorksheetSchema = z
  .object({
    version: z.literal('V1'),
    status: z.enum(['draft', 'reviewed']),
    entries: z.array(ScribeCodingEntrySchema).max(SCRIBE_CODING_MAX_ENTRIES),
  })
  .strict()
  .superRefine((worksheet, ctx) => {
    const ids = new Set<string>();
    const includedCodes = new Set<string>();
    worksheet.entries.forEach((entry, index) => {
      if (ids.has(entry.id))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['entries', index, 'id'],
          message: 'Entry identifiers must be unique.',
        });
      ids.add(entry.id);
      if (worksheet.status === 'reviewed' && entry.decision === 'pending')
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['entries', index, 'decision'],
          message: 'Include or exclude every entry before marking the worksheet reviewed.',
        });
      if (entry.decision === 'include') {
        const key = canonicalJson([entry.system, entry.release.toLowerCase(), entry.code]);
        if (includedCodes.has(key))
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['entries', index, 'code'],
            message: 'This code, system and release are already included.',
          });
        includedCodes.add(key);
      }
    });
  });
export type ScribeCodingWorksheet = z.infer<typeof ScribeCodingWorksheetSchema>;

/** All binding/review metadata is server-owned; only ScribeCodingSaveSchema accepts writes. */
export const ScribeCodingBodySchema = z
  .object({
    worksheet: ScribeCodingWorksheetSchema,
    draftId: identifier,
    draftHash: hash,
    reviewedNoteHash: hash.nullable(),
    reviewedAt: timestamp.nullable(),
    reviewedBy: identifier.nullable(),
  })
  .strict()
  .superRefine((body, ctx) => {
    for (const field of ['reviewedNoteHash', 'reviewedAt', 'reviewedBy'] as const) {
      const expectedPresent = body.worksheet.status === 'reviewed';
      if (expectedPresent !== (body[field] !== null))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: expectedPresent
            ? 'Reviewed worksheets require server review metadata.'
            : 'Draft worksheets cannot carry review metadata.',
        });
    }
  });
export type ScribeCodingBody = z.infer<typeof ScribeCodingBodySchema>;

// Mirrors the encrypted workspace record DTO without importing its server-only implementation.
export const ScribeCodingRecordSchema = z
  .object({
    id: identifier,
    revision: z.number().int().positive(),
    body: ScribeCodingBodySchema,
    clientId: identifier.nullable(),
    sessionId: identifier.nullable(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict();
export type ScribeCodingRecord = z.infer<typeof ScribeCodingRecordSchema>;

export const ScribeCodingSaveSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    draftHash: hash,
    workingNote: MedicalEncounterNoteV1Schema,
    worksheet: ScribeCodingWorksheetSchema,
  })
  .strict();
export type ScribeCodingSave = z.infer<typeof ScribeCodingSaveSchema>;

export const ScribeCodingResponseSchema = z
  .object({
    draft: z.object({ id: identifier, hash, content: MedicalEncounterNoteV1Schema }).strict(),
    signed: z.boolean(),
    signedNoteHash: hash.nullable(),
    record: ScribeCodingRecordSchema.nullable(),
    sourceCurrent: z.boolean().nullable(),
    suggestions: z.array(ScribeCodingEntrySchema).max(SCRIBE_CODING_MAX_ENTRIES),
  })
  .strict()
  .superRefine((response, ctx) => {
    if (response.signed !== (response.signedNoteHash !== null))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['signedNoteHash'],
        message: 'Signed state and signed note identity must agree.',
      });
    if (response.record === null && response.sourceCurrent !== null)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sourceCurrent'],
        message: 'A missing worksheet has no saved source binding.',
      });
    const ids = new Set<string>();
    response.suggestions.forEach((entry, index) => {
      if (
        entry.origin !== 'ai_suggestion' ||
        entry.decision !== 'pending' ||
        entry.system !== null ||
        entry.release !== '' ||
        entry.documentation !== '' ||
        ids.has(entry.id)
      )
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['suggestions', index],
          message: 'AI suggestions must remain unique, unreviewed and unverified.',
        });
      ids.add(entry.id);
    });
  });
export type ScribeCodingResponse = z.infer<typeof ScribeCodingResponseSchema>;

/** Stable full-note bytes for hashing; this identity is not a clinical or cryptographic review. */
export function scribeCodingNoteIdentity(note: MedicalEncounterNoteV1): string {
  return canonicalJson(note);
}

/** UI-only identity, not an integrity/security hash. Never authorizes a saved decision. */
function suggestionId(kind: string, value: unknown): string {
  const text = canonicalJson(value);
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    left = Math.imul(left ^ unit, 0x01000193);
    right = Math.imul(right ^ unit, 0x85ebca6b);
  }
  return `ai-${kind}-${(left >>> 0).toString(16)}-${(right >>> 0).toString(16)}`;
}

/** Reuse existing proposals only. No new AI call, inferred code system/release, or clinical truth. */
export function scribeCodingSuggestions(
  differential: DifferentialDiagnosisV1 | null,
): ScribeCodingEntry[] {
  if (!differential) return [];
  const entries: ScribeCodingEntry[] = [];
  const seen = new Set<string>();
  const add = (kind: string, proposal: unknown, code: string, label: string) => {
    if (
      !code.trim() ||
      code.trim().length > 24 ||
      label.trim().length > 500 ||
      entries.length >= SCRIBE_CODING_MAX_ENTRIES
    )
      return;
    const id = suggestionId(kind, proposal);
    if (seen.has(id)) return;
    const parsed = ScribeCodingEntrySchema.safeParse({
      id,
      sourceSuggestionId: id,
      origin: 'ai_suggestion',
      code,
      label,
      system: null,
      release: '',
      decision: 'pending',
      documentation: '',
    });
    // Do not silently truncate a clinical label/code to make an oversized proposal fit.
    if (!parsed.success) return;
    seen.add(id);
    entries.push(parsed.data);
  };
  for (const candidate of differential.candidates.slice(0, SCRIBE_CODING_MAX_ENTRIES)) {
    if (candidate.icd10Code)
      add(
        'candidate',
        [candidate.icd10Code, candidate.condition],
        candidate.icd10Code,
        candidate.condition,
      );
  }
  for (const nudge of differential.codingNudges.slice(0, SCRIBE_CODING_MAX_ENTRIES)) {
    if (nudge.icd10Code && nudge.kind !== 'DOCUMENTATION_GAP')
      // A nudge message is not a diagnosis label or clinician-confirmed documentation.
      add('nudge', [nudge.kind, nudge.icd10Code], nudge.icd10Code, '');
  }
  return entries;
}
