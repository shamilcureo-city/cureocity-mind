export type SyntheticActivityVertical = 'DOCTOR' | 'THERAPIST';

export interface SyntheticActivityPractitioner {
  id: string;
  fullName: string;
  vertical: SyntheticActivityVertical;
}

export interface SyntheticActivitySession {
  psychologistId: string;
  scheduledAt: Date;
}

export interface PractitionerActivityCount {
  practitionerId: string;
  practitionerName: string;
  sessions: number;
}

export interface CohortActivityStats {
  practitionerCount: number;
  activePractitioners: number;
  totalSessions: number;
  min: number;
  median: number;
  max: number;
  top: PractitionerActivityCount[];
}

export interface SyntheticActivityDay {
  date: string;
  doctor: CohortActivityStats;
  psychologist: CohortActivityStats;
  totalSessions: number;
}

export interface SyntheticActivityCalendar {
  fromDate: typeof SYNTHETIC_ACTIVITY_FROM_DATE;
  throughDate: typeof SYNTHETIC_ACTIVITY_THROUGH_DATE;
  days: SyntheticActivityDay[];
  doctor: CohortActivityStats;
  psychologist: CohortActivityStats;
  totalSessions: number;
}

export const SYNTHETIC_ACTIVITY_FROM_DATE = '2026-09-01' as const;
export const SYNTHETIC_ACTIVITY_THROUGH_DATE = '2026-09-30' as const;

const DAY_MS = 86_400_000;
const OFFSET_MINUTES: Record<SyntheticActivityVertical, number> = {
  DOCTOR: 4 * 60,
  THERAPIST: 5 * 60 + 30,
};

/**
 * The broad UTC read window that covers every September calendar day in both
 * cohorts. Rows are assigned to a day again with their cohort offset below.
 */
export function syntheticActivityQueryRange(): { from: Date; to: Date } {
  const doctor = localDateBounds(SYNTHETIC_ACTIVITY_FROM_DATE, 'DOCTOR');
  const therapist = localDateBounds(SYNTHETIC_ACTIVITY_FROM_DATE, 'THERAPIST');
  const doctorEnd = localDateBounds(SYNTHETIC_ACTIVITY_THROUGH_DATE, 'DOCTOR').to;
  const therapistEnd = localDateBounds(SYNTHETIC_ACTIVITY_THROUGH_DATE, 'THERAPIST').to;

  return {
    from: new Date(Math.min(doctor.from.getTime(), therapist.from.getTime())),
    to: new Date(Math.max(doctorEnd.getTime(), therapistEnd.getTime())),
  };
}

/** Cohort-local yyyy-mm-dd for a UTC instant. Both zones have no DST. */
export function syntheticActivityDateKey(
  instant: Date,
  vertical: SyntheticActivityVertical,
): string {
  const local = new Date(instant.getTime() + OFFSET_MINUTES[vertical] * 60_000);
  return dateKey(local.getUTCFullYear(), local.getUTCMonth() + 1, local.getUTCDate());
}

/** UTC instants bounding one cohort-local calendar day: [from, to). */
export function localDateBounds(
  localDate: string,
  vertical: SyntheticActivityVertical,
): { from: Date; to: Date } {
  const parsed = parseDateKey(localDate);
  if (!parsed) throw new Error(`Invalid local activity date: ${localDate}`);
  const from = new Date(
    Date.UTC(parsed.year, parsed.month - 1, parsed.day) - OFFSET_MINUTES[vertical] * 60_000,
  );
  return { from, to: new Date(from.getTime() + DAY_MS) };
}

/** Monday-first cells for the fixed September 2026 calendar. */
export function syntheticActivityMonthGrid(): Array<string | null> {
  const dates = activityDates();
  const first = parseDateKey(dates[0]!)!;
  const sundayFirst = new Date(Date.UTC(first.year, first.month - 1, first.day)).getUTCDay();
  const leading = (sundayFirst + 6) % 7;
  const cells: Array<string | null> = [...Array<null>(leading).fill(null), ...dates];
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/** Invalid or out-of-month selections fall back to the last seeded day. */
export function normalizeSyntheticActivityDate(value: string | undefined): string {
  return value && value >= SYNTHETIC_ACTIVITY_FROM_DATE && value <= SYNTHETIC_ACTIVITY_THROUGH_DATE
    ? value
    : SYNTHETIC_ACTIVITY_THROUGH_DATE;
}

export function buildSyntheticActivityCalendar(
  practitioners: readonly SyntheticActivityPractitioner[],
  sessions: readonly SyntheticActivitySession[],
): SyntheticActivityCalendar {
  const practitionerById = new Map(practitioners.map((row) => [row.id, row]));
  const countsByDay = new Map<string, Map<string, number>>(
    activityDates().map((date) => [date, new Map()]),
  );
  const monthCounts = new Map<string, number>();

  for (const session of sessions) {
    const practitioner = practitionerById.get(session.psychologistId);
    if (!practitioner) continue;
    const date = syntheticActivityDateKey(session.scheduledAt, practitioner.vertical);
    const dayCounts = countsByDay.get(date);
    if (!dayCounts) continue;
    dayCounts.set(practitioner.id, (dayCounts.get(practitioner.id) ?? 0) + 1);
    monthCounts.set(practitioner.id, (monthCounts.get(practitioner.id) ?? 0) + 1);
  }

  const doctors = practitioners.filter((row) => row.vertical === 'DOCTOR');
  const psychologists = practitioners.filter((row) => row.vertical === 'THERAPIST');
  const days = activityDates().map((date) => {
    const counts = countsByDay.get(date)!;
    const doctor = summarizeCohort(doctors, counts);
    const psychologist = summarizeCohort(psychologists, counts);
    return {
      date,
      doctor,
      psychologist,
      totalSessions: doctor.totalSessions + psychologist.totalSessions,
    };
  });
  const doctor = summarizeCohort(doctors, monthCounts);
  const psychologist = summarizeCohort(psychologists, monthCounts);

  return {
    fromDate: SYNTHETIC_ACTIVITY_FROM_DATE,
    throughDate: SYNTHETIC_ACTIVITY_THROUGH_DATE,
    days,
    doctor,
    psychologist,
    totalSessions: doctor.totalSessions + psychologist.totalSessions,
  };
}

function summarizeCohort(
  practitioners: readonly SyntheticActivityPractitioner[],
  counts: ReadonlyMap<string, number>,
): CohortActivityStats {
  const ranked = practitioners
    .map((practitioner) => ({
      practitionerId: practitioner.id,
      practitionerName: practitioner.fullName,
      sessions: counts.get(practitioner.id) ?? 0,
    }))
    .sort(
      (a, b) =>
        b.sessions - a.sessions ||
        a.practitionerName.localeCompare(b.practitionerName) ||
        a.practitionerId.localeCompare(b.practitionerId),
    );
  const values = ranked.map((row) => row.sessions).sort((a, b) => a - b);
  const totalSessions = values.reduce((sum, value) => sum + value, 0);

  return {
    practitionerCount: practitioners.length,
    activePractitioners: values.filter((value) => value > 0).length,
    totalSessions,
    min: values[0] ?? 0,
    median: median(values),
    max: values.at(-1) ?? 0,
    top: ranked.slice(0, 5),
  };
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const middle = Math.floor(values.length / 2);
  if (values.length % 2 === 1) return values[middle]!;
  return (values[middle - 1]! + values[middle]!) / 2;
}

function activityDates(): string[] {
  return Array.from({ length: 30 }, (_, index) => dateKey(2026, 9, index + 1));
}

function parseDateKey(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function dateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
