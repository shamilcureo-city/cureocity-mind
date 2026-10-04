import { z } from 'zod';

/** Shared public contracts contain administrative data only, never clinical context. */
export const ReceptionTimezoneSchema = z.enum(['Asia/Dubai', 'Asia/Kolkata']);
export const ReceptionModeSchema = z.enum(['ONLINE', 'IN_PERSON']);
const MinutesSchema = z.union([
  z.literal(15),
  z.literal(20),
  z.literal(30),
  z.literal(45),
  z.literal(60),
  z.literal(90),
]);
export const ReceptionHoursSchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1440),
  })
  .strict()
  .refine((rule) => rule.endMinute > rule.startMinute, 'Closing time must follow opening time.');
export const ReceptionFaqSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-zA-Z0-9_-]+$/),
    question: z.string().trim().min(5).max(160),
    answer: z.string().trim().min(1).max(1200),
  })
  .strict();
export const ReceptionSettingsSchema = z
  .object({
    version: z.number().int().min(0),
    enabled: z.boolean(),
    slug: z
      .string()
      .trim()
      .min(3)
      .max(64)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and hyphens.'),
    practiceName: z.string().trim().min(2).max(100),
    timezone: ReceptionTimezoneSchema,
    mode: ReceptionModeSchema,
    slotMinutes: MinutesSchema,
    hours: z.array(ReceptionHoursSchema).max(28),
    faqs: z.array(ReceptionFaqSchema).max(20),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.faqs.map((faq) => faq.id)).size !== value.faqs.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['faqs'],
        message: 'FAQ identifiers must be unique.',
      });
    }
    for (let i = 0; i < value.hours.length; i++) {
      const a = value.hours[i];
      if (a.endMinute - a.startMinute < value.slotMinutes) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['hours', i],
          message: 'Each window must fit a complete appointment.',
        });
      }
      if (
        value.hours.some(
          (b, j) =>
            j < i &&
            a.weekday === b.weekday &&
            a.startMinute < b.endMinute &&
            a.endMinute > b.startMinute,
        )
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['hours', i],
          message: 'Opening hours must not overlap.',
        });
      }
    }
    if (value.enabled && value.hours.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['hours'],
        message: 'Add opening hours before enabling reception.',
      });
    }
  });
export type ReceptionSettings = z.infer<typeof ReceptionSettingsSchema>;
export type ReceptionTimezone = z.infer<typeof ReceptionTimezoneSchema>;
export type ReceptionFaq = z.infer<typeof ReceptionFaqSchema>;
export type ReceptionVertical = 'DOCTOR' | 'THERAPIST';
export type ReceptionRequestKind = 'BOOKING' | 'CANCEL' | 'RESCHEDULE' | 'QUESTION';
export type ReceptionRequestStatus = 'NEW' | 'BOOKED' | 'DECLINED' | 'RESOLVED';

export const ReceptionRequestInputSchema = z
  .object({
    idempotencyKey: z.string().uuid(),
    kind: z.enum(['BOOKING', 'CANCEL', 'RESCHEDULE', 'QUESTION']),
    patientName: z.string().trim().min(2).max(120),
    patientPhone: z
      .string()
      .trim()
      .regex(/^\+[1-9]\d{7,14}$/, 'Use an international phone number, for example +971501234567.'),
    patientEmail: z.string().trim().email().max(254).optional(),
    message: z.string().trim().max(1000).default(''),
    desiredStartAt: z.string().datetime({ offset: true }).optional(),
    consentContact: z.literal(true),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.kind === 'BOOKING' && !value.desiredStartAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['desiredStartAt'],
        message: 'Choose an available appointment.',
      });
    }
    if (value.kind !== 'BOOKING' && !value.message) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['message'],
        message: 'Tell the practice what you need help with.',
      });
    }
  });
export type ReceptionRequestInput = z.infer<typeof ReceptionRequestInputSchema>;
export const ReceptionActionSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('APPROVE_BOOKING'),
      clientId: z.string().min(1).max(128),
      identityVerified: z.literal(true),
    })
    .strict(),
  z.object({ action: z.literal('DECLINE') }).strict(),
  z.object({ action: z.literal('RESOLVE') }).strict(),
  z.object({ action: z.literal('ERASE'), confirmErase: z.literal(true) }).strict(),
]);
export type ReceptionAction = z.infer<typeof ReceptionActionSchema>;

export interface ReceptionSlot {
  startAt: string;
  endAt: string;
  minutes: number;
  mode: 'ONLINE' | 'IN_PERSON';
}
export interface ReceptionBusyInterval {
  startAt: Date;
  endAt: Date;
}
export interface ReceptionRequestView {
  id: string;
  kind: ReceptionRequestKind;
  status: ReceptionRequestStatus;
  patientName: string;
  patientPhone: string;
  patientEmail: string | null;
  message: string;
  desiredStartAt: string | null;
  createdAt: string;
  updatedAt: string;
  appointmentId: string | null;
  sessionId: string | null;
  clientId: string | null;
  events: Array<{ id: string; action: string; createdAt: string }>;
}
export interface ReceptionWorkspace {
  settings: ReceptionSettings;
  practitionerName: string;
  vertical: ReceptionVertical;
  requests: ReceptionRequestView[];
  /** Total NEW enquiries; requests contains at most the oldest 200 pending. */
  pendingCount?: number;
  /** The latest 200 non-NEW enquiries are loaded; older history is omitted. */
  hasMoreHistory?: boolean;
  clients: Array<{ id: string; name: string }>;
}
export interface PublicReception {
  practiceName: string;
  practitionerName: string;
  vertical: ReceptionVertical;
  slug: string;
  timezone: ReceptionTimezone;
  mode: 'ONLINE' | 'IN_PERSON';
  slotMinutes: number;
  faqs: ReceptionFaq[];
  slots: ReceptionSlot[];
}

export function defaultReceptionSettings(practiceName = 'My practice'): ReceptionSettings {
  return {
    version: 0,
    enabled: false,
    slug: '',
    practiceName,
    timezone: 'Asia/Dubai',
    mode: 'IN_PERSON',
    slotMinutes: 30,
    hours: [],
    faqs: [],
  };
}

/** These two supported zones have no daylight-saving transitions. Never infer a zone from the product. */
export function receptionSlots(
  settings: Pick<ReceptionSettings, 'timezone' | 'hours' | 'slotMinutes' | 'mode'>,
  busy: readonly ReceptionBusyInterval[],
  now = new Date(),
  windowDays = 14,
): ReceptionSlot[] {
  if (
    !ReceptionTimezoneSchema.safeParse(settings.timezone).success ||
    !MinutesSchema.safeParse(settings.slotMinutes).success ||
    !Number.isFinite(now.getTime())
  )
    return [];
  const minute = 60_000;
  const day = 24 * 60 * minute;
  const offset = (settings.timezone === 'Asia/Dubai' ? 240 : 330) * minute;
  const midnight = Math.floor((now.getTime() + offset) / day) * day - offset;
  const earliest = now.getTime() + 120 * minute;
  const slots = new Map<string, ReceptionSlot>();
  for (let d = 0; d < Math.min(14, Math.max(0, Math.floor(windowDays))); d++) {
    const localDay = midnight + d * day;
    const weekday = new Date(localDay + offset).getUTCDay();
    for (const rawRule of settings.hours) {
      const parsed = ReceptionHoursSchema.safeParse(rawRule);
      if (!parsed.success || parsed.data.weekday !== weekday) continue;
      const rule = parsed.data;
      for (
        let m = rule.startMinute;
        m + settings.slotMinutes <= rule.endMinute;
        m += settings.slotMinutes
      ) {
        const start = localDay + m * minute;
        const end = start + settings.slotMinutes * minute;
        if (
          start < earliest ||
          busy.some((b) => start < b.endAt.getTime() && end > b.startAt.getTime())
        )
          continue;
        const startAt = new Date(start).toISOString();
        slots.set(startAt, {
          startAt,
          endAt: new Date(end).toISOString(),
          minutes: settings.slotMinutes,
          mode: settings.mode,
        });
      }
    }
  }
  return [...slots.values()].sort((a, b) => a.startAt.localeCompare(b.startAt));
}

/** No model sees patient enquiries. Suggest approved FAQs; never generate clinical answers. */
export function suggestReceptionFaqs(
  question: string,
  faqs: readonly ReceptionFaq[],
): ReceptionFaq[] {
  const words = (value: string) => new Set(value.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
  const terms = words(question.slice(0, 500));
  const stop = new Set([
    'the',
    'and',
    'are',
    'can',
    'you',
    'your',
    'what',
    'how',
    'does',
    'with',
    'for',
    'please',
    'have',
  ]);
  const matches = faqs.map((faq) => ({
    faq,
    score: [...words(faq.question)].filter((w) => terms.has(w) && !stop.has(w)).length,
  }));
  return matches
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((m) => m.faq);
}

export function receptionSlotLabel(startAt: string, timezone: ReceptionTimezone): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(startAt));
}
