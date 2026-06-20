import { z } from 'zod';
import { EvidenceRefSchema } from './medical-note';

/**
 * Sprint DV1 scaffold → Sprint DV6. Differential diagnosis — the
 * reasoning copilot, the medical analogue of the therapy ClinicalReport
 * (`clinical.ts`). Produced by the `differential` pass from the encounter
 * note + transcript; evidence-linked, never auto-applied. Includes
 * ICD-10 coding nudges (DV6.2). See docs/DOCTOR_VERTICAL.md §6, §7.
 */
export const DifferentialCandidateSchema = z.object({
  condition: z.string(),
  icd10Code: z.string().optional(),
  likelihood: z.number().min(0).max(1).optional(),
  supportingEvidence: z.array(EvidenceRefSchema).default([]),
  discriminatingQuestions: z.array(z.string()).default([]),
  suggestedWorkup: z.array(z.string()).default([]),
});
export type DifferentialCandidate = z.infer<typeof DifferentialCandidateSchema>;

/**
 * Sprint DV6.2 — a coding nudge. The 🧾 Rail-3 flag: "documentation
 * supports ICD-10 X" / "add Y to avoid undercoding". `kind` separates a
 * suggested code from a documentation gap that blocks one.
 */
export const CodingNudgeSchema = z.object({
  kind: z.enum(['SUGGESTED_CODE', 'UNDERCODING', 'DOCUMENTATION_GAP']).default('SUGGESTED_CODE'),
  icd10Code: z.string().optional(),
  message: z.string(),
  severity: z.enum(['info', 'warn']).default('info'),
});
export type CodingNudge = z.infer<typeof CodingNudgeSchema>;

export const DifferentialDiagnosisV1Schema = z.object({
  version: z.literal('V1'),
  language: z.string().default('en'),
  /** Ranked differential — most-likely first. */
  candidates: z.array(DifferentialCandidateSchema).default([]),
  /** Red flags that must be actively excluded for this presentation. */
  redFlagsToExclude: z.array(z.string()).default([]),
  /** ICD-10 coding nudges (DV6.2). */
  codingNudges: z.array(CodingNudgeSchema).default([]),
  /** Always-present safety disclaimer — decision-support, not a diagnosis. */
  disclaimer: z.string().default(''),
});
export type DifferentialDiagnosisV1 = z.infer<typeof DifferentialDiagnosisV1Schema>;

/**
 * GET/POST /sessions/[id]/differential response. `differential` is null
 * until the pass has run successfully.
 */
export const DifferentialResponseSchema = z.object({
  status: z.enum(['PENDING', 'COMPLETED', 'FAILED']),
  differential: DifferentialDiagnosisV1Schema.nullable(),
  errorMessage: z.string().nullable().default(null),
});
export type DifferentialResponse = z.infer<typeof DifferentialResponseSchema>;
