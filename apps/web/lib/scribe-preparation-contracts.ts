import { z } from 'zod';
import type { ScribeIntakeVitals } from './scribe-intake-contracts';

const id = z.string().min(1).max(160);
const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Enter a valid date');

export const ScribeTaskBodySchema = z
  .object({
    category: z.enum(['results', 'referral', 'follow_up']),
    title: z.string().trim().min(1).max(300),
    details: z.string().trim().max(2000).default(''),
    dueDate: dateOnly,
    // A work label, not an authenticated staff identity or notification destination.
    assignee: z.string().trim().min(1).max(100).default('Doctor (you)'),
    status: z.enum(['open', 'done', 'cancelled']).default('open'),
    completionNote: z.string().trim().max(1000).default(''),
  })
  .strict();
export type ScribeTaskBody = z.infer<typeof ScribeTaskBodySchema>;
export const CreateScribeTaskSchema = z
  .object({
    clientId: id,
    sessionId: id.optional(),
    task: ScribeTaskBodySchema.omit({ status: true, completionNote: true }),
  })
  .strict();
export const UpdateScribeTaskSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    task: ScribeTaskBodySchema,
  })
  .strict();

export interface ScribeTaskRecord {
  id: string;
  revision: number;
  clientId: string | null;
  sessionId: string | null;
  body: ScribeTaskBody;
  createdAt: string;
  updatedAt: string;
}

export interface ScribeBriefing {
  allergies: { status: 'not_recorded' | 'recorded'; entries: string[] };
  intake: {
    submittedAt: string;
    reasonForVisit: string;
    reviewStatus: 'pending' | 'reviewed';
    authorRole: 'patient' | 'caregiver' | 'staff';
    vitals: ScribeIntakeVitals | null;
  } | null;
  visits: {
    sessionId: string;
    encounterAt: string;
    signedAt: string;
    complaint: string;
    assessment: string;
    plan: string;
    prescriptions: { drug: string; dose: string; frequency: string; duration: string }[];
  }[];
}

export interface ScribePendingWork {
  tasks: ScribeTaskRecord[];
  unsigned: { sessionId: string; clientId: string; patientName: string; encounterAt: string }[];
  // Both query sets are bounded. Never imply this is the complete inbox when capped.
  unsignedMayHaveMore: boolean;
  tasksMayHaveMore: boolean;
}
