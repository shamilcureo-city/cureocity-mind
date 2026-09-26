import { z } from 'zod';

export const SCRIBE_TELECONSULT_HEARTBEAT_MS = 20_000;
export const ScribeTeleconsultConsentSchema = z.enum([
  'pending',
  'granted',
  'declined',
  'withdrawn',
]);
export const ScribeTeleconsultDocumentationSchema = z.enum([
  'idle',
  'preparing',
  'recording',
  'draining',
  'paused',
  'finished',
]);
export const ScribeTeleconsultBodySchema = z
  .object({
    product: z.literal('SCRIBE'),
    psychologistId: z.string().min(1),
    clientId: z.string().min(1),
    sessionId: z.string().min(1),
    linkVersion: z.string().uuid(),
    status: z.enum(['open', 'revoked', 'ended']),
    expiresAt: z.string().datetime(),
    patientConsent: ScribeTeleconsultConsentSchema,
    patientConsentAt: z.string().datetime().nullable(),
    documentationState: ScribeTeleconsultDocumentationSchema,
    documentationHeartbeatAt: z.string().datetime().nullable(),
    documentationStartedAt: z.string().datetime().nullable(),
  })
  .strict();
export type ScribeTeleconsultBody = z.infer<typeof ScribeTeleconsultBodySchema>;
export type ScribeTeleconsultDocumentationState = z.infer<
  typeof ScribeTeleconsultDocumentationSchema
>;
export type ScribeTeleconsultPatientConsent = z.infer<typeof ScribeTeleconsultConsentSchema>;
export interface ScribeTeleconsultPublicStatus {
  id: string;
  revision: number;
  linkVersion: string;
  status: 'open' | 'revoked' | 'ended' | 'expired';
  expiresAt: string;
  patientConsent: ScribeTeleconsultPatientConsent;
  patientConsentAt: string | null;
  documentationState: ScribeTeleconsultDocumentationState;
  documentationHeartbeatAt: string | null;
  canJoin: boolean;
  canDocument: boolean;
}
export type ScribeTeleconsultManagement = ScribeTeleconsultPublicStatus;
export interface ScribeTeleconsultManagementResponse {
  record: ScribeTeleconsultManagement | null;
  configured: boolean;
  joinUrl?: string;
  roomTermination?: 'confirmed' | 'unconfirmed';
}
export interface ScribeTeleconsultTokenResponse extends ScribeTeleconsultPublicStatus {
  token: string;
  url: string;
  roomName: string;
}
const revision = z.number().int().positive().optional();
export const ScribeTeleconsultManagementInputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create-link') }).strict(),
  z.object({ action: z.literal('rotate'), expectedRevision: revision }).strict(),
  z.object({ action: z.literal('revoke'), expectedRevision: revision }).strict(),
  z.object({ action: z.literal('end'), expectedRevision: revision }).strict(),
  z.object({ action: z.literal('token') }).strict(),
  z
    .object({
      action: z.literal('documentation'),
      state: ScribeTeleconsultDocumentationSchema,
      expectedRevision: revision,
      confirmedConsent: z.literal(true).optional(),
    })
    .strict(),
]);
export type ScribeTeleconsultManagementInput = z.infer<
  typeof ScribeTeleconsultManagementInputSchema
>;
export const ScribeTeleconsultPublicInputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('token'), token: z.string().min(1).max(4096) }).strict(),
  z
    .object({
      action: z.literal('consent'),
      token: z.string().min(1).max(4096),
      consent: z.enum(['granted', 'declined', 'withdrawn']),
      expectedRevision: revision,
    })
    .strict(),
]);
