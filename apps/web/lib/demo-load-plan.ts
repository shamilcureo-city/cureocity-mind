/**
 * Deterministic, side-effect-free synthetic workload for calendar and seed data.
 *
 * This module deliberately contains no Prisma import and no patient content. It
 * only describes artificial practitioners, opaque clients, and encounter
 * metadata. Callers decide how and where to persist the returned arrays.
 */

export const DEMO_LOAD_START_DATE = '2026-09-01' as const;
export const DEMO_LOAD_END_DATE = '2026-09-30' as const;
export const DEMO_LOAD_DAY_COUNT = 30 as const;
export const DEMO_LOAD_PRACTITIONER_UID_PREFIX = 'demo-load-' as const;

export const DEMO_LOAD_UAE_DOCTOR_COUNT = 112 as const;
export const DEMO_LOAD_INDIA_PSYCHOLOGIST_COUNT = 89 as const;
export const DEMO_LOAD_DOCTOR_DAILY_MIN = 500 as const;
export const DEMO_LOAD_DOCTOR_DAILY_MAX = 800 as const;
export const DEMO_LOAD_PSYCHOLOGIST_DAILY_TOTAL = 250 as const;

export const DEMO_LOAD_UAE_UTC_OFFSET_MINUTES = 4 * 60;
export const DEMO_LOAD_INDIA_UTC_OFFSET_MINUTES = 5 * 60 + 30;

export type DemoLoadCohort = 'UAE_DOCTOR' | 'INDIA_PSYCHOLOGIST';
export type DemoLoadVertical = 'DOCTOR' | 'THERAPIST';
export type DemoLoadSessionStatus = 'COMPLETED' | 'SCHEDULED';
export type DemoLoadSessionKind = 'TREATMENT';
export type DemoLoadCaptureMode = 'LIVE' | 'DICTATE' | 'UPLOAD';
export type DemoLoadModality = 'SUPPORTIVE';

export interface DemoLoadPractitioner {
  /** Stable synthetic identity used to look up the persisted practitioner id. */
  uid: string;
  email: string;
  phone: string;
  fullName: string;
  vertical: DemoLoadVertical;
  languages: string[];
  city: string;
  province: string;
  years: number;
  specialty: string | null;
  focus: string;
  modalities: string[];
  rciNumber: string;
  medicalRegNumber: string | null;
  createdAt: Date;
  cohort: DemoLoadCohort;
  ordinal: number;
  countryCode: 'AE' | 'IN';
  timezoneOffsetMinutes: number;
}

export interface DemoLoadClient {
  id: string;
  clientFirebaseUid: string;
  practitionerUid: string;
  preferredLanguage: string;
  spokenLanguages: string[];
  status: 'ACTIVE';
  isDemo: true;
}

export interface DemoLoadSession {
  id: string;
  clientId: string;
  practitionerUid: string;
  status: DemoLoadSessionStatus;
  kind: DemoLoadSessionKind;
  scheduledAt: Date;
  startedAt: Date | null;
  endedAt: Date | null;
  createdAt: Date;
  language: string;
  spokenLanguages: string[];
  captureMode: DemoLoadCaptureMode | null;
  tokenNumber: number | null;
  modality: DemoLoadModality | null;
}

export interface DemoLoadAllocation {
  practitionerUid: string;
  practitionerOrdinal: number;
  encounterCount: number;
}

export interface DemoLoadDaySummary {
  dayIndex: number;
  dateKey: string;
  status: DemoLoadSessionStatus;
  doctorEncounterTotal: number;
  psychologistEncounterTotal: number;
  doctorAllocations: DemoLoadAllocation[];
  psychologistAllocations: DemoLoadAllocation[];
}

export interface DemoLoadPlan {
  startDate: typeof DEMO_LOAD_START_DATE;
  endDate: typeof DEMO_LOAD_END_DATE;
  practitioners: DemoLoadPractitioner[];
  clients: DemoLoadClient[];
  sessions: DemoLoadSession[];
  days: DemoLoadDaySummary[];
}

const DOCTOR_SPECIALTIES = [
  'Family Medicine',
  'Internal Medicine',
  'Paediatrics',
  'Cardiology',
  'Dermatology',
  'Endocrinology',
] as const;

const INDIA_LOCATIONS = [
  { city: 'Bengaluru', province: 'Karnataka' },
  { city: 'Chennai', province: 'Tamil Nadu' },
  { city: 'Kochi', province: 'Kerala' },
  { city: 'Hyderabad', province: 'Telangana' },
  { city: 'Mumbai', province: 'Maharashtra' },
  { city: 'New Delhi', province: 'Delhi' },
] as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

function assertDayIndex(dayIndex: number): void {
  if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex >= DEMO_LOAD_DAY_COUNT) {
    throw new RangeError(`dayIndex must be an integer from 0 to ${DEMO_LOAD_DAY_COUNT - 1}`);
  }
}

function parseDateKey(dateKey: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) throw new RangeError(`Invalid date key: ${dateKey}`);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));

  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    throw new RangeError(`Invalid date key: ${dateKey}`);
  }

  return { year, month, day };
}

/** Convert a local wall-clock value at a fixed positive-east offset to UTC. */
export function localDateTimeToUtc(
  dateKey: string,
  hour: number,
  minute: number,
  utcOffsetMinutes: number,
): Date {
  const { year, month, day } = parseDateKey(dateKey);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new RangeError('hour must be an integer from 0 to 23');
  }
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new RangeError('minute must be an integer from 0 to 59');
  }
  if (!Number.isInteger(utcOffsetMinutes)) {
    throw new RangeError('utcOffsetMinutes must be an integer');
  }

  return new Date(Date.UTC(year, month - 1, day, hour, minute) - utcOffsetMinutes * MINUTE_MS);
}

/** Stable date key for one of the 30 days in the synthetic workload. */
export function demoLoadDateKey(dayIndex: number): string {
  assertDayIndex(dayIndex);
  const start = parseDateKey(DEMO_LOAD_START_DATE);
  return new Date(Date.UTC(start.year, start.month - 1, start.day + dayIndex))
    .toISOString()
    .slice(0, 10);
}

/** Deterministic PRNG used only to choose each doctor's daily aggregate. */
function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** The doctors' collective target for a day, always in the inclusive 500–800 range. */
export function doctorEncounterTargetForDay(dayIndex: number): number {
  assertDayIndex(dayIndex);
  const rng = makeRng(20260901 + dayIndex);
  return (
    DEMO_LOAD_DOCTOR_DAILY_MIN +
    Math.floor(rng() * (DEMO_LOAD_DOCTOR_DAILY_MAX - DEMO_LOAD_DOCTOR_DAILY_MIN + 1))
  );
}

/**
 * Allocate a daily total with a one-encounter floor and deterministic,
 * rotating weights. Largest-remainder rounding preserves the exact total.
 */
export function allocateDemoLoadEncounters(
  total: number,
  practitionerUids: readonly string[],
  dayIndex: number,
  weightSpan: number,
): DemoLoadAllocation[] {
  assertDayIndex(dayIndex);
  if (!Number.isInteger(total) || total < practitionerUids.length) {
    throw new RangeError('total must be an integer at least as large as the practitioner count');
  }
  if (practitionerUids.length === 0) {
    throw new RangeError('at least one practitioner is required');
  }
  if (!Number.isInteger(weightSpan) || weightSpan < 2) {
    throw new RangeError('weightSpan must be an integer of at least 2');
  }

  const remaining = total - practitionerUids.length;
  const weights = practitionerUids.map(
    (_, index) => 1 + (((index + 1) * 17 + (dayIndex + 1) * 13) % weightSpan),
  );
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  const rawShares = weights.map((weight) => (remaining * weight) / weightTotal);
  const extra = rawShares.map(Math.floor);
  let undistributed = remaining - extra.reduce((sum, count) => sum + count, 0);

  const remainderOrder = rawShares
    .map((share, index) => ({
      index,
      remainder: share - Math.floor(share),
      rotatedIndex: (index - dayIndex + practitionerUids.length) % practitionerUids.length,
    }))
    .sort(
      (left, right) => right.remainder - left.remainder || left.rotatedIndex - right.rotatedIndex,
    );

  for (const item of remainderOrder) {
    if (undistributed === 0) break;
    extra[item.index] = (extra[item.index] ?? 0) + 1;
    undistributed -= 1;
  }

  return practitionerUids.map((practitionerUid, index) => ({
    practitionerUid,
    practitionerOrdinal: index + 1,
    encounterCount: 1 + (extra[index] ?? 0),
  }));
}

export function buildDemoLoadPractitioners(): DemoLoadPractitioner[] {
  const doctors = Array.from({ length: DEMO_LOAD_UAE_DOCTOR_COUNT }, (_, index) => {
    const ordinal = index + 1;
    const code = pad(ordinal, 4);
    return {
      uid: `demo-load-uae-doctor-${code}`,
      email: `uae-doctor-${code}@demo.cureocity.test`,
      phone: `+9710000${pad(ordinal, 5)}`,
      fullName: `Synthetic UAE Doctor ${code}`,
      vertical: 'DOCTOR' as const,
      languages: ['English', 'Arabic'],
      city: 'Dubai',
      province: 'Dubai',
      years: 3 + ((ordinal * 7) % 23),
      specialty: DOCTOR_SPECIALTIES[index % DOCTOR_SPECIALTIES.length] ?? 'Family Medicine',
      focus: 'Synthetic OPD documentation workload',
      modalities: [],
      rciNumber: `NOT-APPLICABLE-TEST-DHA-2026-${code}`,
      medicalRegNumber: `TEST-DHA-2026-${code}`,
      createdAt: localDateTimeToUtc(DEMO_LOAD_START_DATE, 0, 0, DEMO_LOAD_UAE_UTC_OFFSET_MINUTES),
      cohort: 'UAE_DOCTOR' as const,
      ordinal,
      countryCode: 'AE' as const,
      timezoneOffsetMinutes: DEMO_LOAD_UAE_UTC_OFFSET_MINUTES,
    };
  });

  const psychologists = Array.from({ length: DEMO_LOAD_INDIA_PSYCHOLOGIST_COUNT }, (_, index) => {
    const ordinal = index + 1;
    const code = pad(ordinal, 4);
    const location = INDIA_LOCATIONS[index % INDIA_LOCATIONS.length] ?? INDIA_LOCATIONS[0];
    return {
      uid: `demo-load-india-psychologist-${code}`,
      email: `india-psychologist-${code}@demo.cureocity.test`,
      phone: `+910000${pad(ordinal, 6)}`,
      fullName: `Synthetic India Psychologist ${code}`,
      vertical: 'THERAPIST' as const,
      languages: ['English', 'Hindi'],
      city: location.city,
      province: location.province,
      years: 2 + ((ordinal * 5) % 19),
      specialty: null,
      focus: 'Synthetic counselling documentation workload',
      modalities: ['SUPPORTIVE'],
      rciNumber: `PENDING-TEST-RCI-2026-${code}`,
      medicalRegNumber: null,
      createdAt: localDateTimeToUtc(DEMO_LOAD_START_DATE, 0, 0, DEMO_LOAD_INDIA_UTC_OFFSET_MINUTES),
      cohort: 'INDIA_PSYCHOLOGIST' as const,
      ordinal,
      countryCode: 'IN' as const,
      timezoneOffsetMinutes: DEMO_LOAD_INDIA_UTC_OFFSET_MINUTES,
    };
  });

  return [...doctors, ...psychologists];
}

function statusForDate(dateKey: string): DemoLoadSessionStatus {
  return dateKey === DEMO_LOAD_END_DATE ? 'SCHEDULED' : 'COMPLETED';
}

function captureModeForSequence(sequence: number): DemoLoadCaptureMode {
  const position = (sequence - 1) % 10;
  if (position < 6) return 'LIVE';
  if (position < 9) return 'DICTATE';
  return 'UPLOAD';
}

function sessionStem(
  practitioner: DemoLoadPractitioner,
  dateKey: string,
  sequence: number,
): string {
  const cohort = practitioner.cohort === 'UAE_DOCTOR' ? 'uae-doc' : 'in-psy';
  return `${cohort}-${pad(practitioner.ordinal, 4)}-${dateKey.replaceAll('-', '')}-${pad(sequence, 3)}`;
}

function buildEncounter(
  practitioner: DemoLoadPractitioner,
  dateKey: string,
  status: DemoLoadSessionStatus,
  sequence: number,
): { client: DemoLoadClient; session: DemoLoadSession } {
  const isDoctor = practitioner.vertical === 'DOCTOR';
  const localStartMinutes = isDoctor ? 8 * 60 : 9 * 60;
  const spacingMinutes = isDoctor ? 40 : 90;
  const durationMinutes = isDoctor ? 25 : 50;
  const localMinutes = localStartMinutes + (sequence - 1) * spacingMinutes;
  const scheduledAt = localDateTimeToUtc(
    dateKey,
    Math.floor(localMinutes / 60),
    localMinutes % 60,
    practitioner.timezoneOffsetMinutes,
  );
  const stem = sessionStem(practitioner, dateKey, sequence);
  const clientId = `demo-load-client-${stem}`;
  const spokenLanguages = isDoctor ? ['en', 'ar'] : ['en', 'hi'];
  const completed = status === 'COMPLETED';

  return {
    client: {
      id: clientId,
      clientFirebaseUid: `demo-load-firebase-${stem}`,
      practitionerUid: practitioner.uid,
      preferredLanguage: 'en',
      spokenLanguages: [...spokenLanguages],
      status: 'ACTIVE',
      isDemo: true,
    },
    session: {
      id: `demo-load-session-${stem}`,
      clientId,
      practitionerUid: practitioner.uid,
      status,
      kind: 'TREATMENT',
      scheduledAt,
      startedAt: completed ? new Date(scheduledAt) : null,
      endedAt: completed ? new Date(scheduledAt.getTime() + durationMinutes * MINUTE_MS) : null,
      createdAt: new Date(scheduledAt.getTime() - DAY_MS),
      language: 'en',
      spokenLanguages: [...spokenLanguages],
      captureMode: isDoctor ? captureModeForSequence(sequence) : null,
      tokenNumber: isDoctor ? sequence : null,
      modality: isDoctor ? null : 'SUPPORTIVE',
    },
  };
}

/** Build the complete deterministic plan. This function performs no I/O. */
export function buildDemoLoadPlan(): DemoLoadPlan {
  const practitioners = buildDemoLoadPractitioners();
  const doctors = practitioners.filter((practitioner) => practitioner.cohort === 'UAE_DOCTOR');
  const psychologists = practitioners.filter(
    (practitioner) => practitioner.cohort === 'INDIA_PSYCHOLOGIST',
  );
  const practitionerByUid = new Map(
    practitioners.map((practitioner) => [practitioner.uid, practitioner]),
  );

  const clients: DemoLoadClient[] = [];
  const sessions: DemoLoadSession[] = [];
  const days: DemoLoadDaySummary[] = [];

  for (let dayIndex = 0; dayIndex < DEMO_LOAD_DAY_COUNT; dayIndex += 1) {
    const dateKey = demoLoadDateKey(dayIndex);
    const status = statusForDate(dateKey);
    const doctorEncounterTotal = doctorEncounterTargetForDay(dayIndex);
    const psychologistEncounterTotal = DEMO_LOAD_PSYCHOLOGIST_DAILY_TOTAL;
    const doctorAllocations = allocateDemoLoadEncounters(
      doctorEncounterTotal,
      doctors.map((practitioner) => practitioner.uid),
      dayIndex,
      9,
    );
    const psychologistAllocations = allocateDemoLoadEncounters(
      psychologistEncounterTotal,
      psychologists.map((practitioner) => practitioner.uid),
      dayIndex,
      5,
    );

    days.push({
      dayIndex,
      dateKey,
      status,
      doctorEncounterTotal,
      psychologistEncounterTotal,
      doctorAllocations,
      psychologistAllocations,
    });

    for (const allocation of [...doctorAllocations, ...psychologistAllocations]) {
      const practitioner = practitionerByUid.get(allocation.practitionerUid);
      if (!practitioner) throw new Error(`Unknown practitioner: ${allocation.practitionerUid}`);

      for (let sequence = 1; sequence <= allocation.encounterCount; sequence += 1) {
        const encounter = buildEncounter(practitioner, dateKey, status, sequence);
        clients.push(encounter.client);
        sessions.push(encounter.session);
      }
    }
  }

  return {
    startDate: DEMO_LOAD_START_DATE,
    endDate: DEMO_LOAD_END_DATE,
    practitioners,
    clients,
    sessions,
    days,
  };
}
