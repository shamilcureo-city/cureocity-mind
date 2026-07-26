import { z } from 'zod';
import { CuidSchema, IndianPhoneSchema, IsoDateTimeSchema } from './common';

/**
 * Marketing V1 — public therapist profile pages + real-slot appointment.
 *
 * The public surface lives at /therapists (directory) and
 * /therapists/<slug> (profile + appointment widget). Profile FIELDS reuse
 * the existing Psychologist directory columns (headline, bio,
 * specialties, …) edited via PATCH /psychologists/me; this module adds
 * what's new: the slug + publish state, FAQs, weekly availability, and
 * the appointment lifecycle.
 *
 * All availability minutes are IST wall-clock (India is single-zone,
 * no DST). Slot instants cross the wire as UTC ISO strings.
 */

// ---------------------------------------------------------------------------
// Profile: slug, FAQs, publish
// ---------------------------------------------------------------------------

export const PublicSlugSchema = z
  .string()
  .min(3)
  .max(60)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'lowercase words separated by single hyphens');

export const ProfileFaqSchema = z.object({
  q: z.string().min(1).max(200),
  a: z.string().min(1).max(1000),
});
export type ProfileFaq = z.infer<typeof ProfileFaqSchema>;

export const UpdateMarketingInputSchema = z
  .object({
    publicSlug: PublicSlugSchema,
    faqs: z.array(ProfileFaqSchema).max(10),
  })
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: 'At least one field must be provided' });
export type UpdateMarketingInput = z.infer<typeof UpdateMarketingInputSchema>;

export const PublishMarketingInputSchema = z.object({
  publish: z.boolean(),
});
export type PublishMarketingInput = z.infer<typeof PublishMarketingInputSchema>;

/** One unmet requirement on the publish checklist. */
export const PublishChecklistItemSchema = z.object({
  key: z.enum(['headline', 'bio', 'locationCity', 'specialties']),
  label: z.string(),
  done: z.boolean(),
});
export type PublishChecklistItem = z.infer<typeof PublishChecklistItemSchema>;

export const MarketingStateSchema = z.object({
  publicSlug: z.string().nullable(),
  publishedAt: IsoDateTimeSchema.nullable(),
  faqs: z.array(ProfileFaqSchema),
  checklist: z.array(PublishChecklistItemSchema),
  /** Absolute public URL when published (origin + /therapists/<slug>). */
  publicUrl: z.string().nullable(),
});
export type MarketingState = z.infer<typeof MarketingStateSchema>;

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

const MINUTES_IN_DAY = 24 * 60;

export const AvailabilityRuleInputSchema = z
  .object({
    /** 0 = Sunday … 6 = Saturday, IST. */
    weekday: z.number().int().min(0).max(6),
    /** Minutes since IST midnight. */
    startMinute: z
      .number()
      .int()
      .min(0)
      .max(MINUTES_IN_DAY - 1),
    endMinute: z.number().int().min(1).max(MINUTES_IN_DAY),
    slotMinutes: z.union([z.literal(30), z.literal(45), z.literal(60), z.literal(90)]),
  })
  .refine((r) => r.endMinute - r.startMinute >= r.slotMinutes, {
    message: 'window must fit at least one slot',
  });
export type AvailabilityRuleInput = z.infer<typeof AvailabilityRuleInputSchema>;

export const SetAvailabilityInputSchema = z.object({
  rules: z.array(AvailabilityRuleInputSchema).max(28),
});
export type SetAvailabilityInput = z.infer<typeof SetAvailabilityInputSchema>;

// ---------------------------------------------------------------------------
// Public slot feed + appointment creation
// ---------------------------------------------------------------------------

export const PublicSlotSchema = z.object({
  /** Slot start, UTC ISO. */
  startAt: IsoDateTimeSchema,
  /** Slot length in minutes (from the owning rule). */
  minutes: z.number().int().positive(),
});
export type PublicSlot = z.infer<typeof PublicSlotSchema>;

export const PublicSlotsResponseSchema = z.object({
  slots: z.array(PublicSlotSchema),
  /** Whether this therapist has any bookable windows configured at all. */
  hasAvailability: z.boolean(),
});
export type PublicSlotsResponse = z.infer<typeof PublicSlotsResponseSchema>;

export const CreateAppointmentInputSchema = z.object({
  slug: PublicSlugSchema,
  /** Must exactly match a currently-offered slot instant. */
  startAt: IsoDateTimeSchema,
  patientName: z.string().trim().min(1).max(200),
  patientPhone: IndianPhoneSchema,
  patientEmail: z.string().email().optional(),
  /** What they want help with — optional, health info, encrypted at rest. */
  concern: z.string().trim().max(500).optional(),
  /** Explicit consent to be contacted about this request. */
  consentContact: z.literal(true),
});
export type CreateAppointmentInput = z.infer<typeof CreateAppointmentInputSchema>;

export const CreateAppointmentResponseSchema = z.object({
  appointmentId: CuidSchema,
  status: z.literal('REQUESTED'),
});
export type CreateAppointmentResponse = z.infer<typeof CreateAppointmentResponseSchema>;

// ---------------------------------------------------------------------------
// Therapist-facing appointment inbox
// ---------------------------------------------------------------------------

export const AppointmentStatusSchema = z.enum(['REQUESTED', 'CONFIRMED', 'DECLINED', 'CANCELLED']);
export type AppointmentStatus = z.infer<typeof AppointmentStatusSchema>;

export const AppointmentSchema = z.object({
  id: CuidSchema,
  status: AppointmentStatusSchema,
  startAt: IsoDateTimeSchema,
  endAt: IsoDateTimeSchema,
  /** Decrypted server-side for the owning therapist only. */
  patientName: z.string(),
  patientPhone: z.string(),
  patientEmail: z.string().nullable(),
  concern: z.string().nullable(),
  clientId: CuidSchema.nullable(),
  sessionId: CuidSchema.nullable(),
  createdAt: IsoDateTimeSchema,
});
export type Appointment = z.infer<typeof AppointmentSchema>;

export const ListAppointmentsResponseSchema = z.object({
  items: z.array(AppointmentSchema),
});
export type ListAppointmentsResponse = z.infer<typeof ListAppointmentsResponseSchema>;

export const ConfirmAppointmentResponseSchema = z.object({
  clientId: CuidSchema,
  sessionId: CuidSchema,
});
export type ConfirmAppointmentResponse = z.infer<typeof ConfirmAppointmentResponseSchema>;
