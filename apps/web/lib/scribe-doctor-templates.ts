import { z } from 'zod';
import {
  DEFAULT_SCRIBE_NOTE_STYLE,
  ScribeNoteStyleSchema,
} from './scribe-personalization-contracts';
import { ScribeConsultationDocumentTypeSchema } from './scribe-consultation-documents';

export const SCRIBE_DOCTOR_TEMPLATE_MAX_RECORDS = 50;
export const SCRIBE_DOCUMENT_TEMPLATE_PROMPT_LABELS = {
  recipient: 'Referral recipient',
  referral_reason: 'Reason for referral',
  clinical_question: 'Clinical question for the recipient',
  requested_action: 'Requested action',
  enclosures: 'Relevant enclosures, if applicable',
  patient_questions: 'Patient questions to address',
  doctor_clarification: 'Doctor clarification for the patient',
  follow_up_clarification: 'Follow-up clarification',
  certificate_recipient: 'Certificate recipient',
  certificate_purpose: 'Certificate purpose',
  clinician_statement: 'Clinician statement requiring independent verification',
  relevant_dates: 'Relevant dates requiring independent verification',
} as const;
export type ScribeDocumentTemplatePrompt = keyof typeof SCRIBE_DOCUMENT_TEMPLATE_PROMPT_LABELS;
export const SCRIBE_DOCUMENT_TEMPLATE_PROMPTS = {
  referral: ['recipient', 'referral_reason', 'clinical_question', 'requested_action', 'enclosures'],
  patient_summary: ['patient_questions', 'doctor_clarification', 'follow_up_clarification'],
  medical_certificate: [
    'certificate_recipient',
    'certificate_purpose',
    'clinician_statement',
    'relevant_dates',
  ],
} as const satisfies Record<
  z.infer<typeof ScribeConsultationDocumentTypeSchema>,
  readonly ScribeDocumentTemplatePrompt[]
>;

const prompt = z.enum([
  'recipient',
  'referral_reason',
  'clinical_question',
  'requested_action',
  'enclosures',
  'patient_questions',
  'doctor_clarification',
  'follow_up_clarification',
  'certificate_recipient',
  'certificate_purpose',
  'clinician_statement',
  'relevant_dates',
]);
export const ScribeDoctorTemplateSchema = z
  .discriminatedUnion('kind', [
    z
      .object({
        kind: z.literal('note_presentation'),
        name: z.string().trim().min(1).max(80),
        style: ScribeNoteStyleSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal('document_skeleton'),
        name: z.string().trim().min(1).max(80),
        documentType: ScribeConsultationDocumentTypeSchema,
        prompts: z.array(prompt).min(1).max(5),
      })
      .strict(),
  ])
  .superRefine((template, ctx) => {
    if (template.kind !== 'document_skeleton') return;
    const allowed: readonly string[] = SCRIBE_DOCUMENT_TEMPLATE_PROMPTS[template.documentType];
    if (
      new Set(template.prompts).size !== template.prompts.length ||
      template.prompts.some((key) => !allowed.includes(key))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['prompts'],
        message: 'Choose each fixed prompt once, for the selected document type.',
      });
    }
  });
export type ScribeDoctorTemplate = z.infer<typeof ScribeDoctorTemplateSchema>;
export const ScribeDoctorTemplateBodySchema = z
  .object({
    version: z.literal(1),
    operationId: z.string().uuid(),
    /** Immutable fingerprint of the original create request; edits never reset retry identity. */
    createHash: z.string().regex(/^[a-f0-9]{64}$/),
    template: ScribeDoctorTemplateSchema,
  })
  .strict();
export type ScribeDoctorTemplateBody = z.infer<typeof ScribeDoctorTemplateBodySchema>;
const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/);
export const ScribeDoctorTemplateRecordSchema = z
  .object({
    id: identifier,
    revision: z.number().int().positive(),
    body: ScribeDoctorTemplateBodySchema,
    clientId: z.null(),
    sessionId: z.null(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type ScribeDoctorTemplateRecord = z.infer<typeof ScribeDoctorTemplateRecordSchema>;
export const ScribeDoctorTemplatesResponseSchema = z
  .object({
    records: z.array(ScribeDoctorTemplateRecordSchema).max(SCRIBE_DOCTOR_TEMPLATE_MAX_RECORDS),
  })
  .strict();
export type ScribeDoctorTemplatesResponse = z.infer<typeof ScribeDoctorTemplatesResponseSchema>;
export const ScribeDoctorTemplateCreateSchema = z
  .object({
    operationId: z.string().uuid(),
    template: ScribeDoctorTemplateSchema,
    containsNoPatientData: z.literal(true),
  })
  .strict();
export type ScribeDoctorTemplateCreate = z.infer<typeof ScribeDoctorTemplateCreateSchema>;
export const ScribeDoctorTemplateUpdateSchema = z
  .object({
    revision: z.number().int().positive(),
    template: ScribeDoctorTemplateSchema,
    containsNoPatientData: z.literal(true),
  })
  .strict();
export type ScribeDoctorTemplateUpdate = z.infer<typeof ScribeDoctorTemplateUpdateSchema>;
export const ScribeDoctorTemplateDeleteSchema = z
  .object({ revision: z.number().int().positive() })
  .strict();
export type ScribeDoctorTemplateDelete = z.infer<typeof ScribeDoctorTemplateDeleteSchema>;
export const ScribeDoctorTemplateResponseSchema = z
  .object({ record: ScribeDoctorTemplateRecordSchema })
  .strict();
export const ScribeDoctorTemplateMutationResponseSchema = ScribeDoctorTemplateResponseSchema;
export type ScribeDoctorTemplateResponse = z.infer<typeof ScribeDoctorTemplateResponseSchema>;
export const ScribeDoctorTemplateDeleteResponseSchema = z
  .object({ deletedId: identifier, revision: z.number().int().positive() })
  .strict();
export type ScribeDoctorTemplateDeleteResponse = z.infer<
  typeof ScribeDoctorTemplateDeleteResponseSchema
>;

export const SCRIBE_BUILTIN_DOCTOR_TEMPLATES: ScribeDoctorTemplate[] = [
  {
    kind: 'note_presentation',
    name: 'OPD consultation',
    style: ScribeNoteStyleSchema.parse(DEFAULT_SCRIBE_NOTE_STYLE),
  },
  {
    kind: 'note_presentation',
    name: 'Follow-up focus',
    style: ScribeNoteStyleSchema.parse({
      firstVisit: DEFAULT_SCRIBE_NOTE_STYLE.firstVisit,
      followUp: {
        ...DEFAULT_SCRIBE_NOTE_STYLE.followUp,
        order: [
          'chiefComplaint',
          'assessment',
          'plan',
          'hpi',
          'vitals',
          'physicalExam',
          'reviewOfSystems',
        ],
      },
    }),
  },
  ...(['referral', 'patient_summary', 'medical_certificate'] as const).map((documentType) => ({
    kind: 'document_skeleton' as const,
    name: {
      referral: 'Referral prompts',
      patient_summary: 'Patient summary prompts',
      medical_certificate: 'Certificate completion prompts',
    }[documentType],
    documentType,
    prompts: [...SCRIBE_DOCUMENT_TEMPLATE_PROMPTS[documentType]],
  })),
];

/** No names, source notes, findings or dates are copied into a reusable skeleton. */
export function renderScribeDocumentTemplate(
  template: Extract<ScribeDoctorTemplate, { kind: 'document_skeleton' }>,
): string {
  const valid = ScribeDoctorTemplateSchema.parse(template);
  if (valid.kind !== 'document_skeleton') throw new Error('A document skeleton is required.');
  return valid.prompts
    .map((key) => {
      const label = SCRIBE_DOCUMENT_TEMPLATE_PROMPT_LABELS[key];
      return `${label}\n[[Complete: ${label}]]`;
    })
    .join('\n\n');
}

/** Also catches unfinished, case-varied, spaced or full-width versions of the marker. */
export function hasUnresolvedScribeTemplateFields(text: string): boolean {
  return /\[\s*\[\s*complete\b/i.test(text.normalize('NFKC'));
}
