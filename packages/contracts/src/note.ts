import { z } from 'zod';
import { CuidSchema, IsoDateTimeSchema } from './common';
import { SessionModalitySchema } from './client';

// ============================================================================
// Pass 1 outputs — diarized transcript + affect features. Shipped by
// @cureocity/llm Pass 1 backends, persisted to NoteDraft, consumed by
// affect-engine-service (Sprint 4) and therapist-web (Sprint 7).
// ============================================================================

export const SpeakerSchema = z.enum(['therapist', 'client', 'unknown']);
export type Speaker = z.infer<typeof SpeakerSchema>;

export const SpeakerSegmentSchema = z.object({
  speaker: SpeakerSchema,
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  text: z.string(),
});
export type SpeakerSegment = z.infer<typeof SpeakerSegmentSchema>;

export const AffectFeatureSchema = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  valence: z.number().min(-1).max(1),
  arousal: z.number().min(0).max(1),
  notes: z.string().optional(),
});
export type AffectFeature = z.infer<typeof AffectFeatureSchema>;

// ============================================================================
// Pass 2 output — TherapyNoteV1. Authoritative shape for therapy notes;
// signed notes (after clinician review) carry the same payload.
// ============================================================================

export const RiskSeveritySchema = z.enum(['none', 'low', 'medium', 'high', 'critical']);
export type RiskSeverity = z.infer<typeof RiskSeveritySchema>;

export const TherapyNoteV1Schema = z.object({
  version: z.literal('V1'),
  modality: SessionModalitySchema,
  subjective: z.string().min(1),
  objective: z.string().min(1),
  assessment: z.string().min(1),
  plan: z.string().min(1),
  riskFlags: z.object({
    severity: RiskSeveritySchema,
    indicators: z.array(z.string()).default([]),
    details: z.string().optional(),
  }),
  modalitySpecific: z.record(z.unknown()).optional(),
  phaseHints: z
    .array(
      z.object({
        phase: z.string(),
        confidence: z.number().min(0).max(1),
        rationale: z.string().optional(),
      }),
    )
    .default([]),
});
export type TherapyNoteV1 = z.infer<typeof TherapyNoteV1Schema>;

// ============================================================================
// NoteDraft — server-side row representing the in-flight or completed
// generation of a note for a single Session. Sprint 2 PR 4.
// ============================================================================

export const NoteDraftStatusSchema = z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED']);
export type NoteDraftStatus = z.infer<typeof NoteDraftStatusSchema>;

export const NoteRiskSeveritySchema = z.enum(['NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export type NoteRiskSeverity = z.infer<typeof NoteRiskSeveritySchema>;

export const NoteDraftSchema = z.object({
  id: CuidSchema,
  sessionId: CuidSchema,
  status: NoteDraftStatusSchema,
  transcript: z.string().nullable(),
  speakerSegments: z.array(SpeakerSegmentSchema).nullable(),
  affectFeatures: z.array(AffectFeatureSchema).nullable(),
  content: TherapyNoteV1Schema.nullable(),
  riskSeverity: NoteRiskSeveritySchema.nullable(),
  totalCostInr: z.string(), // Postgres Decimal serialised as string
  errorMessage: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type NoteDraft = z.infer<typeof NoteDraftSchema>;
