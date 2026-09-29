import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildSyntheticActivityCalendar,
  localDateBounds,
  normalizeSyntheticActivityDate,
  syntheticActivityDateKey,
  syntheticActivityMonthGrid,
  syntheticActivityQueryRange,
  type SyntheticActivityPractitioner,
  type SyntheticActivitySession,
} from './demo-activity';

const practitioners: SyntheticActivityPractitioner[] = [
  { id: 'd1', fullName: 'Dr. A', vertical: 'DOCTOR' },
  { id: 'd2', fullName: 'Dr. B', vertical: 'DOCTOR' },
  { id: 'd3', fullName: 'Dr. C', vertical: 'DOCTOR' },
  { id: 'p1', fullName: 'Psychologist A', vertical: 'THERAPIST' },
  { id: 'p2', fullName: 'Psychologist B', vertical: 'THERAPIST' },
];

function sessions(psychologistId: string, at: string, count: number): SyntheticActivitySession[] {
  return Array.from({ length: count }, () => ({ psychologistId, scheduledAt: new Date(at) }));
}

describe('synthetic activity date boundaries', () => {
  it('reads the broad UTC window covering both September cohorts', () => {
    const range = syntheticActivityQueryRange();
    expect(range.from.toISOString()).toBe('2026-08-31T18:30:00.000Z');
    expect(range.to.toISOString()).toBe('2026-09-30T20:00:00.000Z');
  });

  it('uses exclusive next-midnight bounds for Dubai and Kolkata', () => {
    expect(localDateBounds('2026-09-30', 'DOCTOR')).toEqual({
      from: new Date('2026-09-29T20:00:00.000Z'),
      to: new Date('2026-09-30T20:00:00.000Z'),
    });
    expect(localDateBounds('2026-09-30', 'THERAPIST')).toEqual({
      from: new Date('2026-09-29T18:30:00.000Z'),
      to: new Date('2026-09-30T18:30:00.000Z'),
    });
  });

  it('assigns midnight edges to the correct cohort-local day', () => {
    expect(syntheticActivityDateKey(new Date('2026-09-29T20:00:00Z'), 'DOCTOR')).toBe('2026-09-30');
    expect(syntheticActivityDateKey(new Date('2026-09-30T19:59:59Z'), 'DOCTOR')).toBe('2026-09-30');
    expect(syntheticActivityDateKey(new Date('2026-09-30T20:00:00Z'), 'DOCTOR')).toBe('2026-10-01');
    expect(syntheticActivityDateKey(new Date('2026-09-29T18:30:00Z'), 'THERAPIST')).toBe(
      '2026-09-30',
    );
    expect(syntheticActivityDateKey(new Date('2026-09-30T18:30:00Z'), 'THERAPIST')).toBe(
      '2026-10-01',
    );
  });
});

describe('synthetic activity aggregation', () => {
  it('zero-fills the month and keeps cohorts and practitioner distributions separate', () => {
    const calendar = buildSyntheticActivityCalendar(practitioners, [
      ...sessions('d1', '2026-09-01T08:00:00Z', 3),
      ...sessions('d2', '2026-09-01T09:00:00Z', 1),
      ...sessions('p1', '2026-09-01T08:00:00Z', 2),
      ...sessions('p2', '2026-09-01T09:00:00Z', 2),
    ]);

    expect(calendar.days).toHaveLength(30);
    expect(calendar.days[0]).toMatchObject({ date: '2026-09-01', totalSessions: 8 });
    expect(calendar.days[0]!.doctor).toMatchObject({
      practitionerCount: 3,
      activePractitioners: 2,
      totalSessions: 4,
      min: 0,
      median: 1,
      max: 3,
    });
    expect(calendar.days[0]!.doctor.top[0]).toEqual({
      practitionerId: 'd1',
      practitionerName: 'Dr. A',
      sessions: 3,
    });
    expect(calendar.days[0]!.psychologist).toMatchObject({
      practitionerCount: 2,
      activePractitioners: 2,
      totalSessions: 4,
      min: 2,
      median: 2,
      max: 2,
    });
    expect(calendar.days[1]).toMatchObject({ date: '2026-09-02', totalSessions: 0 });
    expect(calendar.totalSessions).toBe(8);
  });

  it('keeps Sep 30 edge rows and rejects Oct 1 in each cohort timezone', () => {
    const calendar = buildSyntheticActivityCalendar(practitioners, [
      ...sessions('d1', '2026-09-30T19:59:59Z', 1),
      ...sessions('d1', '2026-09-30T20:00:00Z', 7),
      ...sessions('p1', '2026-09-30T18:29:59Z', 1),
      ...sessions('p1', '2026-09-30T18:30:00Z', 7),
      ...sessions('not-synthetic', '2026-09-10T08:00:00Z', 20),
    ]);

    expect(calendar.days.at(-1)).toMatchObject({ date: '2026-09-30', totalSessions: 2 });
    expect(calendar.totalSessions).toBe(2);
  });
});

describe('synthetic activity month navigation', () => {
  it('creates a Monday-first five-week grid for September 2026', () => {
    const grid = syntheticActivityMonthGrid();
    expect(grid).toHaveLength(35);
    expect(grid[0]).toBeNull();
    expect(grid[1]).toBe('2026-09-01');
    expect(grid[30]).toBe('2026-09-30');
    expect(grid.slice(31)).toEqual([null, null, null, null]);
  });

  it('accepts only dates inside the fixed test month', () => {
    expect(normalizeSyntheticActivityDate('2026-09-14')).toBe('2026-09-14');
    expect(normalizeSyntheticActivityDate('2026-10-01')).toBe('2026-09-30');
    expect(normalizeSyntheticActivityDate('not-a-date')).toBe('2026-09-30');
    expect(normalizeSyntheticActivityDate(undefined)).toBe('2026-09-30');
  });
});

describe('synthetic activity console boundary', () => {
  it('stays admin-gated, synthetic-only and visibly labelled without client PII reads', () => {
    const source = readFileSync(
      resolve(import.meta.dirname, '../app/console/activity/page.tsx'),
      'utf8',
    );
    const guard = source.indexOf('await requirePageAdmin()');
    const firstRead = source.indexOf('prisma.psychologist.findMany');

    expect(guard).toBeGreaterThan(-1);
    expect(firstRead).toBeGreaterThan(guard);
    expect(source.match(/isSynthetic: true/g)).toHaveLength(2);
    expect(source).toContain('Synthetic test data only');
    expect(source).toContain('Do not use this page as evidence');
    expect(source).not.toContain('decryptClient');
    expect(source).not.toContain('fullNameEncrypted');
  });
});
