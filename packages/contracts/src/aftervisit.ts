import { z } from 'zod';

/**
 * Sprint DV1 scaffold — patient-facing after-visit summary. STUB for DV3;
 * plugs into the existing PatientShare artefact pipeline (portal +
 * WhatsApp), so it needs no new delivery channel.
 * See docs/DOCTOR_VERTICAL.md §6.
 */
export const AfterVisitSummaryV1Schema = z.object({
  version: z.literal('V1'),
  locale: z.string().default('en'),
  greeting: z.string().default(''),
  whatWeDiscussed: z.array(z.string()).default([]),
  medications: z.array(z.string()).default([]),
  instructions: z.array(z.string()).default([]),
  followUp: z.string().default(''),
  redFlags: z.array(z.string()).default([]),
});
export type AfterVisitSummaryV1 = z.infer<typeof AfterVisitSummaryV1Schema>;
