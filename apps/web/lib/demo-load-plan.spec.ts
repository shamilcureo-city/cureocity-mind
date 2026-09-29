import { describe, expect, it } from 'vitest';

import {
  allocateDemoLoadEncounters,
  buildDemoLoadPlan,
  DEMO_LOAD_DAY_COUNT,
  DEMO_LOAD_DOCTOR_DAILY_MAX,
  DEMO_LOAD_DOCTOR_DAILY_MIN,
  DEMO_LOAD_END_DATE,
  DEMO_LOAD_INDIA_PSYCHOLOGIST_COUNT,
  DEMO_LOAD_INDIA_UTC_OFFSET_MINUTES,
  DEMO_LOAD_PSYCHOLOGIST_DAILY_TOTAL,
  DEMO_LOAD_START_DATE,
  DEMO_LOAD_UAE_DOCTOR_COUNT,
  DEMO_LOAD_UAE_UTC_OFFSET_MINUTES,
  demoLoadDateKey,
  doctorEncounterTargetForDay,
  localDateTimeToUtc,
} from './demo-load-plan';

describe('demo load plan', () => {
  it('builds the requested clearly synthetic practitioner cohorts', () => {
    const plan = buildDemoLoadPlan();
    const doctors = plan.practitioners.filter((practitioner) => practitioner.vertical === 'DOCTOR');
    const psychologists = plan.practitioners.filter(
      (practitioner) => practitioner.vertical === 'THERAPIST',
    );

    expect(doctors).toHaveLength(DEMO_LOAD_UAE_DOCTOR_COUNT);
    expect(psychologists).toHaveLength(DEMO_LOAD_INDIA_PSYCHOLOGIST_COUNT);
    expect(new Set(plan.practitioners.map((practitioner) => practitioner.uid)).size).toBe(
      plan.practitioners.length,
    );
    expect(new Set(plan.practitioners.map((practitioner) => practitioner.email)).size).toBe(
      plan.practitioners.length,
    );

    expect(doctors[0]?.medicalRegNumber).toBe('TEST-DHA-2026-0001');
    expect(doctors.at(-1)?.medicalRegNumber).toBe('TEST-DHA-2026-0112');
    expect(
      doctors.every((doctor) => /^TEST-DHA-2026-\d{4}$/.test(doctor.medicalRegNumber ?? '')),
    ).toBe(true);
    expect(psychologists[0]?.rciNumber).toBe('PENDING-TEST-RCI-2026-0001');
    expect(psychologists.at(-1)?.rciNumber).toBe('PENDING-TEST-RCI-2026-0089');
    expect(
      psychologists.every((psychologist) =>
        /^PENDING-TEST-RCI-2026-\d{4}$/.test(psychologist.rciNumber),
      ),
    ).toBe(true);
    expect(
      plan.practitioners.every((practitioner) => practitioner.fullName.startsWith('Synthetic ')),
    ).toBe(true);
    expect(plan.practitioners.every((practitioner) => practitioner.email.endsWith('.test'))).toBe(
      true,
    );
  });

  it('covers every day from September 1 through September 30, 2026', () => {
    const plan = buildDemoLoadPlan();

    expect(plan.startDate).toBe(DEMO_LOAD_START_DATE);
    expect(plan.endDate).toBe(DEMO_LOAD_END_DATE);
    expect(plan.days).toHaveLength(DEMO_LOAD_DAY_COUNT);
    expect(plan.days[0]?.dateKey).toBe('2026-09-01');
    expect(plan.days.at(-1)?.dateKey).toBe('2026-09-30');
    expect(plan.days.slice(0, -1).every((day) => day.status === 'COMPLETED')).toBe(true);
    expect(plan.days.at(-1)?.status).toBe('SCHEDULED');
  });

  it('uses exact daily totals, unequal allocations, and keeps every practitioner active', () => {
    const plan = buildDemoLoadPlan();

    for (const day of plan.days) {
      expect(day.doctorEncounterTotal).toBeGreaterThanOrEqual(DEMO_LOAD_DOCTOR_DAILY_MIN);
      expect(day.doctorEncounterTotal).toBeLessThanOrEqual(DEMO_LOAD_DOCTOR_DAILY_MAX);
      expect(day.psychologistEncounterTotal).toBe(DEMO_LOAD_PSYCHOLOGIST_DAILY_TOTAL);
      expect(day.doctorAllocations).toHaveLength(DEMO_LOAD_UAE_DOCTOR_COUNT);
      expect(day.psychologistAllocations).toHaveLength(DEMO_LOAD_INDIA_PSYCHOLOGIST_COUNT);
      expect(
        day.doctorAllocations.reduce((sum, allocation) => sum + allocation.encounterCount, 0),
      ).toBe(day.doctorEncounterTotal);
      expect(
        day.psychologistAllocations.reduce((sum, allocation) => sum + allocation.encounterCount, 0),
      ).toBe(DEMO_LOAD_PSYCHOLOGIST_DAILY_TOTAL);
      expect(day.doctorAllocations.every((allocation) => allocation.encounterCount > 0)).toBe(true);
      expect(day.psychologistAllocations.every((allocation) => allocation.encounterCount > 0)).toBe(
        true,
      );
      expect(
        new Set(day.doctorAllocations.map((allocation) => allocation.encounterCount)).size,
      ).toBeGreaterThan(1);
      expect(
        new Set(day.psychologistAllocations.map((allocation) => allocation.encounterCount)).size,
      ).toBeGreaterThan(1);
    }

    const sessionTotal = plan.days.reduce(
      (sum, day) => sum + day.doctorEncounterTotal + day.psychologistEncounterTotal,
      0,
    );
    expect(plan.sessions).toHaveLength(sessionTotal);
    expect(plan.clients).toHaveLength(sessionTotal);
    expect(new Set(plan.sessions.map((session) => session.id)).size).toBe(sessionTotal);
    expect(new Set(plan.clients.map((client) => client.id)).size).toBe(sessionTotal);
  });

  it('is reproducible without relying on the current clock', () => {
    const first = buildDemoLoadPlan();
    const second = buildDemoLoadPlan();

    expect(second).toEqual(first);
    expect(doctorEncounterTargetForDay(0)).toBe(doctorEncounterTargetForDay(0));
    expect(demoLoadDateKey(29)).toBe('2026-09-30');
  });

  it('turns UAE and India local slots into explicit UTC instants', () => {
    expect(
      localDateTimeToUtc('2026-09-01', 8, 0, DEMO_LOAD_UAE_UTC_OFFSET_MINUTES).toISOString(),
    ).toBe('2026-09-01T04:00:00.000Z');
    expect(
      localDateTimeToUtc('2026-09-01', 9, 0, DEMO_LOAD_INDIA_UTC_OFFSET_MINUTES).toISOString(),
    ).toBe('2026-09-01T03:30:00.000Z');

    const plan = buildDemoLoadPlan();
    const firstDoctor = plan.practitioners.find(
      (practitioner) => practitioner.uid === 'demo-load-uae-doctor-0001',
    );
    const firstPsychologist = plan.practitioners.find(
      (practitioner) => practitioner.uid === 'demo-load-india-psychologist-0001',
    );
    const firstDoctorSession = plan.sessions.find(
      (session) => session.practitionerUid === firstDoctor?.uid,
    );
    const firstPsychologistSession = plan.sessions.find(
      (session) => session.practitionerUid === firstPsychologist?.uid,
    );

    expect(firstDoctorSession?.scheduledAt.toISOString()).toBe('2026-09-01T04:00:00.000Z');
    expect(firstPsychologistSession?.scheduledAt.toISOString()).toBe('2026-09-01T03:30:00.000Z');
  });

  it('uses completed timestamps before September 30 and leaves future sessions unstarted', () => {
    const plan = buildDemoLoadPlan();
    const completed = plan.sessions.filter((session) => session.status === 'COMPLETED');
    const scheduled = plan.sessions.filter((session) => session.status === 'SCHEDULED');

    expect(completed.length).toBeGreaterThan(0);
    expect(scheduled.length).toBeGreaterThan(0);
    expect(completed.every((session) => session.startedAt && session.endedAt)).toBe(true);
    expect(
      scheduled.every((session) => session.startedAt === null && session.endedAt === null),
    ).toBe(true);
    expect(
      scheduled.every((session) => session.scheduledAt.toISOString().startsWith('2026-09-30')),
    ).toBe(true);

    const doctorSession = plan.sessions.find((session) => session.captureMode !== null);
    const psychologistSession = plan.sessions.find((session) => session.modality !== null);
    expect(doctorSession).toMatchObject({ captureMode: 'LIVE', tokenNumber: 1, modality: null });
    expect(psychologistSession).toMatchObject({
      captureMode: null,
      tokenNumber: null,
      modality: 'SUPPORTIVE',
    });
  });

  it('contains only opaque client metadata and no clinical-content fields', () => {
    const plan = buildDemoLoadPlan();
    const prohibitedKeys = [
      'fullName',
      'contactEmail',
      'contactPhone',
      'presentingConcerns',
      'diagnosis',
      'note',
      'transcript',
      'audio',
    ];

    for (const client of plan.clients.slice(0, 100)) {
      expect(Object.keys(client).some((key) => prohibitedKeys.includes(key))).toBe(false);
    }
    for (const session of plan.sessions.slice(0, 100)) {
      expect(Object.keys(session).some((key) => prohibitedKeys.includes(key))).toBe(false);
    }
  });

  it('rejects impossible allocations and malformed local dates', () => {
    expect(() => allocateDemoLoadEncounters(1, ['one', 'two'], 0, 3)).toThrow(RangeError);
    expect(() => localDateTimeToUtc('2026-02-30', 9, 0, 0)).toThrow(RangeError);
  });
});
