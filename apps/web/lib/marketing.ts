import type { Psychologist } from '@prisma/client';
import type { PublicSlot, PublishChecklistItem } from '@cureocity/contracts';

/**
 * Marketing V1 — the slot engine + publish checklist. Pure functions
 * (no I/O) so the booking conflict rules are unit-testable.
 *
 * All availability rules are IST wall-clock (India is single-zone, no
 * DST — a fixed +05:30 is correct year-round). Slot instants are UTC.
 */

export const IST_OFFSET_MINUTES = 5.5 * 60;
const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;

/** How far ahead the public page offers slots. */
export const SLOT_WINDOW_DAYS = 14;
/** Requests must be at least this far in the future (IST clock). */
export const MIN_LEAD_MINUTES = 120;

export interface WeeklyRule {
  weekday: number; // 0 = Sunday … 6 = Saturday, IST
  startMinute: number; // minutes since IST midnight
  endMinute: number;
  slotMinutes: number;
  /** MK2 — 'ONLINE' | 'IN_PERSON'; defaults ONLINE when absent. */
  mode?: string;
}

export interface BusyInterval {
  startAt: Date;
  endAt: Date;
}

/** The IST calendar day (UTC instant of IST midnight) containing `at`. */
function istMidnightUtc(at: Date): Date {
  const istMs = at.getTime() + IST_OFFSET_MINUTES * MS_PER_MINUTE;
  const dayStartIst = Math.floor(istMs / MS_PER_DAY) * MS_PER_DAY;
  return new Date(dayStartIst - IST_OFFSET_MINUTES * MS_PER_MINUTE);
}

/** IST weekday (0 = Sunday) for a UTC instant of IST midnight. */
function istWeekday(istMidnight: Date): number {
  const istMs = istMidnight.getTime() + IST_OFFSET_MINUTES * MS_PER_MINUTE;
  // 1970-01-01 was a Thursday (4).
  return (Math.floor(istMs / MS_PER_DAY) + 4) % 7;
}

function overlaps(aStart: number, aEnd: number, b: BusyInterval): boolean {
  return aStart < b.endAt.getTime() && aEnd > b.startAt.getTime();
}

/**
 * Materialise the bookable slots for the next SLOT_WINDOW_DAYS.
 *
 * A slot is offered when it starts ≥ MIN_LEAD_MINUTES from `now` and
 * overlaps no busy interval (REQUESTED/CONFIRMED appointments and the
 * therapist's own SCHEDULED sessions both count as busy — a public
 * request must never double-book either).
 */
export function computeSlots(
  rules: WeeklyRule[],
  busy: BusyInterval[],
  now: Date,
  windowDays: number = SLOT_WINDOW_DAYS,
): PublicSlot[] {
  if (rules.length === 0) return [];
  const earliest = now.getTime() + MIN_LEAD_MINUTES * MS_PER_MINUTE;
  const firstDay = istMidnightUtc(now);
  const out: PublicSlot[] = [];

  for (let d = 0; d < windowDays; d++) {
    const dayStart = new Date(firstDay.getTime() + d * MS_PER_DAY);
    const weekday = istWeekday(dayStart);
    for (const rule of rules) {
      if (rule.weekday !== weekday) continue;
      for (
        let m = rule.startMinute;
        m + rule.slotMinutes <= rule.endMinute;
        m += rule.slotMinutes
      ) {
        const startMs = dayStart.getTime() + m * MS_PER_MINUTE;
        if (startMs < earliest) continue;
        const endMs = startMs + rule.slotMinutes * MS_PER_MINUTE;
        if (busy.some((b) => overlaps(startMs, endMs, b))) continue;
        out.push({
          startAt: new Date(startMs).toISOString(),
          minutes: rule.slotMinutes,
          mode: rule.mode === 'IN_PERSON' ? 'IN_PERSON' : 'ONLINE',
        });
      }
    }
  }
  out.sort((a, b) => a.startAt.localeCompare(b.startAt));
  return out;
}

/**
 * Whether `startAt` is one of the currently-offered slots. Run inside
 * the create-appointment transaction (with busy freshly loaded) so two
 * concurrent requests for the same slot cannot both pass.
 * Returns the slot's length in minutes, or null when not offered.
 */
export function offeredSlot(
  rules: WeeklyRule[],
  busy: BusyInterval[],
  now: Date,
  startAt: Date,
): PublicSlot | null {
  const wanted = startAt.toISOString();
  return computeSlots(rules, busy, now).find((s) => s.startAt === wanted) ?? null;
}

export function offeredSlotMinutes(
  rules: WeeklyRule[],
  busy: BusyInterval[],
  now: Date,
  startAt: Date,
): number | null {
  return offeredSlot(rules, busy, now, startAt)?.minutes ?? null;
}

// ---------------------------------------------------------------------------
// Publish checklist + slug
// ---------------------------------------------------------------------------

type ChecklistFields = Pick<Psychologist, 'headline' | 'bio' | 'locationCity' | 'specialties'>;

/** What a profile needs before it can go live. Enforced server-side. */
export function profilePublishChecklist(psy: ChecklistFields): PublishChecklistItem[] {
  return [
    { key: 'headline', label: 'A one-line headline', done: !!psy.headline?.trim() },
    { key: 'bio', label: 'An About section (your bio)', done: !!psy.bio?.trim() },
    { key: 'locationCity', label: 'Your city', done: !!psy.locationCity?.trim() },
    {
      key: 'specialties',
      label: 'At least one specialty',
      done: (psy.specialties ?? []).length > 0,
    },
  ];
}

export function checklistComplete(items: PublishChecklistItem[]): boolean {
  return items.every((i) => i.done);
}

/** "Dr. Priya Nair" → "priya-nair". Uniqueness is the caller's job. */
export function slugify(fullName: string): string {
  return (
    fullName
      .toLowerCase()
      .replace(/^(dr|mr|ms|mrs|prof)\.?\s+/, '')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50)
      .replace(/-+$/, '') || 'therapist'
  );
}
