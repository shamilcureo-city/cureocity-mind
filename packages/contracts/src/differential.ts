import { z } from 'zod';
import { EvidenceRefSchema } from './medical-note';

/**
 * Sprint DV1 scaffold — differential diagnosis (the reasoning copilot,
 * the medical analogue of the therapy ClinicalReport). STUB for DV6.
 * See docs/DOCTOR_VERTICAL.md §6.
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

export const DifferentialDiagnosisV1Schema = z.object({
  version: z.literal('V1'),
  candidates: z.array(DifferentialCandidateSchema).default([]),
});
export type DifferentialDiagnosisV1 = z.infer<typeof DifferentialDiagnosisV1Schema>;
