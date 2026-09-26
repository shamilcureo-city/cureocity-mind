import { z } from 'zod';

const id = z.string().min(1).max(160);
// Broad input-integrity bounds, not diagnostic thresholds. These are never
// promoted into ClinicalReading or a note without a separate clinical action.
export const ScribeIntakeVitalsSchema = z
  .object({
    measuredAt: z.string().datetime(),
    bpSystolic: z.number().finite().int().min(20).max(350).optional(),
    bpDiastolic: z.number().finite().int().min(10).max(250).optional(),
    heartRateBpm: z.number().finite().int().min(10).max(350).optional(),
    spo2Pct: z.number().finite().min(1).max(100).optional(),
    tempCelsius: z.number().finite().min(25).max(45).optional(),
    weightKg: z.number().finite().positive().max(1000).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      !Object.entries(value).some(([key, number]) => key !== 'measuredAt' && number !== undefined)
    )
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Include at least one measured value' });
    if ((value.bpSystolic === undefined) !== (value.bpDiastolic === undefined))
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Include both blood pressure values' });
    if (
      value.bpSystolic !== undefined &&
      value.bpDiastolic !== undefined &&
      value.bpDiastolic >= value.bpSystolic
    )
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Check the blood pressure values' });
  });
export type ScribeIntakeVitals = z.infer<typeof ScribeIntakeVitalsSchema>;

export function intakeVitalsText(vitals: ScribeIntakeVitals): string {
  return [
    vitals.bpSystolic !== undefined ? `BP ${vitals.bpSystolic}/${vitals.bpDiastolic} mmHg` : '',
    vitals.heartRateBpm !== undefined ? `Pulse ${vitals.heartRateBpm} bpm` : '',
    vitals.spo2Pct !== undefined ? `SpO₂ ${vitals.spo2Pct}%` : '',
    vitals.tempCelsius !== undefined ? `Temperature ${vitals.tempCelsius} °C` : '',
    vitals.weightKg !== undefined ? `Weight ${vitals.weightKg} kg` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}
export const ScribeIntakeReportSchema = z
  .object({
    authorName: z.string().trim().min(1).max(100),
    authorRole: z.enum(['patient', 'caregiver', 'staff']),
    reasonForVisit: z.string().trim().min(1).max(2000),
    medications: z.string().trim().max(2000).default(''),
    allergyStatus: z.enum(['unknown', 'none_reported', 'reported']),
    allergies: z.string().trim().max(1000).default(''),
    history: z.string().trim().max(3000).default(''),
    vitals: ScribeIntakeVitalsSchema.nullable().default(null),
    acknowledged: z.literal(true),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.allergyStatus === 'reported' && !value.allergies)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['allergies'],
        message: 'Describe reported allergies',
      });
    if (value.allergyStatus !== 'reported' && value.allergies)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['allergies'],
        message: 'Select reported allergies when providing allergy details',
      });
  });
export type ScribeIntakeReport = z.infer<typeof ScribeIntakeReportSchema>;

export const ScribeIntakeBodySchema = z
  .object({
    tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
    expiresAt: z.string().datetime(),
    revokedAt: z.string().datetime().nullable(),
    submittedAt: z.string().datetime().nullable(),
    report: ScribeIntakeReportSchema.nullable(),
    // Names and roles are self-reported. No shared practitioner membership implies staff authority.
    authorVerified: z.literal(false),
    review: z
      .object({
        status: z.enum(['pending', 'reviewed', 'rejected']),
        reviewedBy: id.nullable(),
        reviewedAt: z.string().datetime().nullable(),
        note: z.string().max(2000),
      })
      .strict(),
  })
  .strict();
export type ScribeIntakeBody = z.infer<typeof ScribeIntakeBodySchema>;
export const CreateScribeIntakeSchema = z
  .object({
    expiresInHours: z.number().int().min(1).max(168).default(24),
    sessionId: id.optional(),
  })
  .strict();
export const ReviewScribeIntakeSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    action: z.enum(['revoke', 'reviewed', 'rejected']),
    note: z.string().trim().max(2000).default(''),
  })
  .strict();
export const SubmitScribeIntakeSchema = z
  .object({
    psychologistId: id,
    recordId: id,
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    report: ScribeIntakeReportSchema,
  })
  .strict();

export interface ScribeIntakeRecord {
  id: string;
  revision: number;
  clientId: string | null;
  sessionId: string | null;
  createdAt: string;
  updatedAt: string;
  body: Omit<ScribeIntakeBody, 'tokenHash'>;
}
