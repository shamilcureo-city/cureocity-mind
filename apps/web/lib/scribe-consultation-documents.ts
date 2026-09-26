import { z } from 'zod';

/** These documents are reviewed drafts, not new signatures, issued certificates or sent referrals. */
export const SCRIBE_CONSULTATION_DOCUMENT_TYPES = [
  'referral',
  'patient_summary',
  'medical_certificate',
] as const;
export const SCRIBE_CONSULTATION_DOCUMENT_LABELS = {
  referral: 'Referral draft',
  patient_summary: 'Patient summary draft',
  medical_certificate: 'Medical certificate draft',
} as const;
export const SCRIBE_CONSULTATION_DOCUMENT_MAX_ADDITIONS = 12_000;
export const SCRIBE_CONSULTATION_DOCUMENT_MAX_PACKETS = 10;
export const ScribeConsultationDocumentTypeSchema = z.enum(SCRIBE_CONSULTATION_DOCUMENT_TYPES);
export type ScribeConsultationDocumentType = z.infer<typeof ScribeConsultationDocumentTypeSchema>;
const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime({ offset: true });

export const ScribeConsultationDocumentSchema = z
  .object({
    id: ScribeConsultationDocumentTypeSchema,
    type: ScribeConsultationDocumentTypeSchema,
    sourceSections: z
      .array(
        z
          .object({ label: z.string().min(1).max(160), text: z.string().min(1).max(24_000) })
          .strict(),
      )
      .max(12),
    additions: z.string().max(SCRIBE_CONSULTATION_DOCUMENT_MAX_ADDITIONS),
    status: z.enum(['draft', 'reviewed']),
    reviewedAt: timestamp.nullable(),
    reviewedBy: identifier.nullable(),
  })
  .strict()
  .superRefine((document, ctx) => {
    if (document.id !== document.type)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['id'],
        message: 'Document identity must match its type.',
      });
    const reviewed = document.status === 'reviewed';
    if (reviewed !== (document.reviewedAt !== null) || reviewed !== (document.reviewedBy !== null))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['status'],
        message: 'Review metadata must agree with document status.',
      });
  });
export type ScribeConsultationDocument = z.infer<typeof ScribeConsultationDocumentSchema>;

export const ScribeConsultationDocumentPacketBodySchema = z
  .object({
    version: z.literal(1),
    operationId: z.string().uuid(),
    sourceHash: hash,
    noteId: identifier,
    signedAt: timestamp,
    requestHash: hash,
    documents: z.array(ScribeConsultationDocumentSchema).min(1).max(3),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (new Set(body.documents.map((document) => document.id)).size !== body.documents.length)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['documents'],
        message: 'Select each document type only once.',
      });
  });
export type ScribeConsultationDocumentPacketBody = z.infer<
  typeof ScribeConsultationDocumentPacketBodySchema
>;

export const ScribeConsultationDocumentPacketSchema = z
  .object({
    id: identifier,
    revision: z.number().int().positive(),
    body: ScribeConsultationDocumentPacketBodySchema,
    clientId: identifier,
    sessionId: identifier,
    createdAt: timestamp,
    updatedAt: timestamp,
    sourceCurrent: z.boolean(),
  })
  .strict();
export type ScribeConsultationDocumentPacket = z.infer<
  typeof ScribeConsultationDocumentPacketSchema
>;

export const ScribeConsultationDocumentSourceSchema = z
  .object({
    state: z.enum(['ready', 'unsigned', 'unavailable']),
    hash: hash.nullable(),
    noteId: identifier.nullable(),
    signedAt: timestamp.nullable(),
  })
  .strict()
  .superRefine((source, ctx) => {
    const complete = source.hash !== null && source.noteId !== null && source.signedAt !== null;
    if (
      (source.state === 'ready' && !complete) ||
      (source.state !== 'ready' && source.hash !== null)
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['state'],
        message: 'Ready sources require a complete signed source identity.',
      });
  });
export type ScribeConsultationDocumentSource = z.infer<
  typeof ScribeConsultationDocumentSourceSchema
>;

export const ScribeConsultationDocumentsResponseSchema = z
  .object({
    source: ScribeConsultationDocumentSourceSchema,
    packets: z
      .array(ScribeConsultationDocumentPacketSchema)
      .max(SCRIBE_CONSULTATION_DOCUMENT_MAX_PACKETS),
  })
  .strict();
export type ScribeConsultationDocumentsResponse = z.infer<
  typeof ScribeConsultationDocumentsResponseSchema
>;

export const ScribeConsultationDocumentsCreateSchema = z
  .object({
    operationId: z.string().uuid(),
    expectedSourceHash: hash,
    types: z.array(ScribeConsultationDocumentTypeSchema).min(1).max(3),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (new Set(input.types).size !== input.types.length)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['types'],
        message: 'Select each document type only once.',
      });
  });
export type ScribeConsultationDocumentsCreate = z.infer<
  typeof ScribeConsultationDocumentsCreateSchema
>;

export const ScribeConsultationDocumentUpdateSchema = z
  .object({
    revision: z.number().int().positive(),
    documentId: ScribeConsultationDocumentTypeSchema,
    additions: z.string().max(SCRIBE_CONSULTATION_DOCUMENT_MAX_ADDITIONS),
    reviewed: z.boolean(),
  })
  .strict();
export type ScribeConsultationDocumentUpdate = z.infer<
  typeof ScribeConsultationDocumentUpdateSchema
>;
