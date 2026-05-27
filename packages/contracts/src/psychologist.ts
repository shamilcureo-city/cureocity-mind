import { z } from 'zod';
import { CuidSchema, IndianPhoneSchema, IsoDateTimeSchema } from './common';

export const PsychologistStatusSchema = z.enum([
  'PENDING_VERIFICATION',
  'ACTIVE',
  'SUSPENDED',
  'OFFBOARDED',
]);

export const PsychologistRoleSchema = z.enum(['THERAPIST', 'ADMIN']);
export type PsychologistRole = z.infer<typeof PsychologistRoleSchema>;

export const RciNumberSchema = z
  .string()
  .regex(/^[A-Z]\d+$/, 'RCI number format: leading letter + digits (e.g. A12345)');

export const CreatePsychologistInputSchema = z.object({
  fullName: z.string().min(1).max(200),
  email: z.string().email(),
  phone: IndianPhoneSchema,
  rciNumber: RciNumberSchema,
});

export const PsychologistSchema = z.object({
  id: CuidSchema,
  firebaseUid: z.string().min(1),
  email: z.string().email(),
  fullName: z.string(),
  phone: z.string(),
  rciNumber: z.string(),
  rciVerifiedAt: IsoDateTimeSchema.nullable(),
  status: PsychologistStatusSchema,
  role: PsychologistRoleSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export type CreatePsychologistInput = z.infer<typeof CreatePsychologistInputSchema>;
export type Psychologist = z.infer<typeof PsychologistSchema>;
export type PsychologistStatus = z.infer<typeof PsychologistStatusSchema>;
