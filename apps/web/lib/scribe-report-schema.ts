import { z } from 'zod';

export const REPORT_MAX_BYTES = 2 * 1024 * 1024;
export const REPORT_MAX_PAGES = 5;
export const ReportMimeSchema = z.enum(['application/pdf', 'image/jpeg', 'image/png']);
export const ReportCandidateSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().trim().min(1).max(160),
  value: z.string().trim().max(160),
  unit: z.string().trim().max(80),
  reportDate: z.string().trim().max(80),
  page: z.number().int().min(1).max(REPORT_MAX_PAGES),
  sourceText: z.string().min(1).max(600),
  included: z.boolean(),
});
export const ReportBodySchema = z.object({
  version: z.literal(1),
  status: z.enum(['candidate', 'confirmed']),
  original: z.object({
    name: z.string().min(1).max(180),
    mime: ReportMimeSchema,
    size: z.number().int().positive().max(REPORT_MAX_BYTES),
    pages: z.number().int().min(1).max(REPORT_MAX_PAGES),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    base64: z
      .string()
      .min(1)
      .max(Math.ceil(REPORT_MAX_BYTES / 3) * 4),
  }),
  candidates: z.array(ReportCandidateSchema).min(1).max(100),
  extractedAt: z.string().datetime(),
  reviewedAt: z.string().datetime().nullable(),
  reviewedBy: z.string().nullable(),
});
export const ReportReviewInputSchema = z
  .object({
    revision: z.number().int().positive(),
    candidates: z.array(ReportCandidateSchema).min(1).max(100),
    originalReviewed: z.literal(true),
    patientMatched: z.literal(true),
  })
  .strict();
export type ReportBody = z.infer<typeof ReportBodySchema>;
export type ReportCandidate = z.infer<typeof ReportCandidateSchema>;
export type ReportSummary = Omit<ReportBody, 'original'> & {
  original: Omit<ReportBody['original'], 'base64'>;
};
export function reportSummary(body: ReportBody): ReportSummary {
  const { base64: _bytes, ...original } = body.original;
  return { ...body, original };
}

/** Edits cannot rewrite the extraction evidence or lose an unreviewed row silently. */
export function reviewReportCandidates(original: ReportBody, candidates: ReportCandidate[]) {
  if (candidates.length !== original.candidates.length) return false;
  const seen = new Set<string>();
  return candidates.every((candidate) => {
    const source = original.candidates.find((row) => row.id === candidate.id);
    if (!source || seen.has(candidate.id)) return false;
    seen.add(candidate.id);
    return candidate.page === source.page && candidate.sourceText === source.sourceText;
  });
}
