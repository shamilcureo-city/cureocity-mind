import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  computeSlots,
  offeredSlotMinutes,
  profilePublishChecklist,
  checklistComplete,
  slugify,
  type WeeklyRule,
} from './marketing';

/**
 * The slot engine is the safety boundary between a public form and the
 * therapist's calendar — these tests pin the IST math and the
 * double-booking rules.
 */

// Monday 2026-07-27 09:00 IST = 03:30 UTC.
const MONDAY_0900_IST = new Date('2026-07-27T03:30:00.000Z');

const MONDAY_MORNINGS: WeeklyRule[] = [
  // Mondays 10:00–13:00 IST, hour slots.
  { weekday: 1, startMinute: 600, endMinute: 780, slotMinutes: 60 },
];

describe('computeSlots', () => {
  it('materialises IST wall-clock windows as UTC instants', () => {
    const slots = computeSlots(MONDAY_MORNINGS, [], MONDAY_0900_IST, 8);
    // From 09:00 IST the 2h lead excludes today's 10:00; 11:00 starts
    // exactly at the boundary and IS offered. An 8-day window reaches
    // next Monday, which offers the full run.
    expect(slots.map((s) => s.startAt)).toEqual([
      '2026-07-27T05:30:00.000Z', // Mon 11:00 IST (10:00 inside lead)
      '2026-07-27T06:30:00.000Z', // Mon 12:00 IST
      '2026-08-03T04:30:00.000Z', // next Mon 10:00 IST
      '2026-08-03T05:30:00.000Z',
      '2026-08-03T06:30:00.000Z',
    ]);
    expect(slots.every((s) => s.minutes === 60)).toBe(true);
  });

  it('excludes slots that collide with busy intervals (booked or scheduled)', () => {
    const busy = [
      {
        startAt: new Date('2026-08-03T05:30:00.000Z'),
        endAt: new Date('2026-08-03T06:30:00.000Z'),
      },
    ];
    const slots = computeSlots(MONDAY_MORNINGS, busy, MONDAY_0900_IST, 8);
    expect(slots.map((s) => s.startAt)).not.toContain('2026-08-03T05:30:00.000Z');
    expect(slots.map((s) => s.startAt)).toContain('2026-08-03T04:30:00.000Z');
  });

  it('excludes PARTIAL overlaps, not just exact matches', () => {
    // A 45-min session starting mid-slot must knock out the whole slot.
    const busy = [
      {
        startAt: new Date('2026-08-03T05:00:00.000Z'), // 10:30 IST
        endAt: new Date('2026-08-03T05:45:00.000Z'), // 11:15 IST
      },
    ];
    const slots = computeSlots(MONDAY_MORNINGS, busy, MONDAY_0900_IST, 8);
    const starts = slots.map((s) => s.startAt);
    expect(starts).not.toContain('2026-08-03T04:30:00.000Z'); // 10:00 overlaps tail
    expect(starts).not.toContain('2026-08-03T05:30:00.000Z'); // 11:00 overlaps head
    expect(starts).toContain('2026-08-03T06:30:00.000Z'); // 12:00 clear
  });

  it('a window that does not fit a whole slot offers nothing at the tail', () => {
    // 10:00–11:30 with 60-min slots → only 10:00 per Monday (a second
    // slot would need the window to reach 12:00). 8-day window: today's
    // Monday 10:00 falls inside the 2h lead, next Monday's is offered.
    const rules: WeeklyRule[] = [{ weekday: 1, startMinute: 600, endMinute: 690, slotMinutes: 60 }];
    const slots = computeSlots(rules, [], new Date('2026-07-20T03:30:00.000Z'), 8);
    expect(slots.map((s) => s.startAt)).toEqual(['2026-07-27T04:30:00.000Z']);
  });

  it('returns [] with no rules', () => {
    expect(computeSlots([], [], MONDAY_0900_IST)).toEqual([]);
  });

  it('handles the IST/UTC date-line: a 00:30 IST slot lands on the PREVIOUS UTC day', () => {
    // Tuesday 00:30 IST = Monday 19:00 UTC.
    const rules: WeeklyRule[] = [{ weekday: 2, startMinute: 30, endMinute: 90, slotMinutes: 60 }];
    const slots = computeSlots(rules, [], MONDAY_0900_IST, 3);
    expect(slots.map((s) => s.startAt)).toEqual(['2026-07-27T19:00:00.000Z']);
  });
});

describe('offeredSlotMinutes', () => {
  it('accepts an offered instant and rejects a fabricated one', () => {
    const offered = new Date('2026-08-03T04:30:00.000Z');
    expect(offeredSlotMinutes(MONDAY_MORNINGS, [], MONDAY_0900_IST, offered)).toBe(60);
    // 10:15 IST is inside the window but not a slot boundary.
    const offBoundary = new Date('2026-08-03T04:45:00.000Z');
    expect(offeredSlotMinutes(MONDAY_MORNINGS, [], MONDAY_0900_IST, offBoundary)).toBeNull();
  });

  it('rejects a slot the moment a competing hold exists', () => {
    const wanted = new Date('2026-08-03T04:30:00.000Z');
    const busy = [{ startAt: wanted, endAt: new Date('2026-08-03T05:30:00.000Z') }];
    expect(offeredSlotMinutes(MONDAY_MORNINGS, busy, MONDAY_0900_IST, wanted)).toBeNull();
  });
});

describe('publish checklist', () => {
  const base = { headline: 'x', bio: 'y', locationCity: 'Kochi', specialties: ['Anxiety'] };
  it('passes a complete profile and pinpoints the gap on an incomplete one', () => {
    expect(checklistComplete(profilePublishChecklist(base))).toBe(true);
    const missingCity = profilePublishChecklist({ ...base, locationCity: '  ' });
    expect(checklistComplete(missingCity)).toBe(false);
    expect(missingCity.find((i) => i.key === 'locationCity')?.done).toBe(false);
  });
});

describe('slugify', () => {
  it('strips honorifics, punctuation, and case', () => {
    expect(slugify('Dr. Priya Nair')).toBe('priya-nair');
    expect(slugify("Anjali D'Souza")).toBe('anjali-d-souza');
    expect(slugify('  ')).toBe('therapist');
  });
});

describe('Mind pilot acquisition journey', () => {
  const webRoot = join(import.meta.dirname, '..');
  const read = (path: string) => readFileSync(join(webRoot, path), 'utf8');

  it('presents application and member paths without self-serve or invite dead ends', () => {
    const landing = read('app/page.tsx');
    const nav = read('components/landing/LandingNav.tsx');
    const login = read('app/login/page.tsx');
    const onboarding = read('app/onboarding/page.tsx');
    const form = read('components/app/OnboardingForm.tsx');

    expect(landing).toContain('Apply to join the pilot');
    expect(landing).not.toContain('Start free — no card');
    expect(nav).toContain('Apply to join the pilot');
    expect(nav).toContain('Sign in');
    expect(login).toContain('Request pilot access');
    expect(login).toContain('copy.acquisition.helpHref');
    expect(onboarding).toContain('initialFullName={me.fullName}');
    expect(onboarding).toContain('initialEmail={me.email}');
    expect(form).toContain("useState(initialFullName ?? '')");
    expect(form).toContain("useState(initialEmail ?? '')");
  });
});
