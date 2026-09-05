import { describe, expect, it } from 'vitest';
import { buildMindTodayProgress, isFinalizedMindNote } from '@/components/app/MindTodayProgress';

const session = (overrides: Record<string, unknown> = {}) => ({
  status: 'COMPLETED',
  client: { isDemo: false },
  noteDraft: { status: 'COMPLETED' },
  therapyNote: null as { locked: boolean; signedAt: Date } | null,
  ...overrides,
});
const signedNote = { locked: true, signedAt: new Date('2026-09-05T10:00:00.000Z') };

describe('Mind Today documentation progress', () => {
  it('does not reward a saved or reopened note as a finalized record', () => {
    expect(isFinalizedMindNote(null)).toBe(false);
    expect(isFinalizedMindNote({ ...signedNote, locked: false })).toBe(false);
    expect(isFinalizedMindNote(signedNote)).toBe(true);
  });

  it('excludes demo, booked, active and cancelled sessions from completed-document milestones', () => {
    expect(
      buildMindTodayProgress([
        session({ client: { isDemo: true }, therapyNote: signedNote }),
        session({ status: 'SCHEDULED' }),
        session({ status: 'IN_PROGRESS' }),
        session({ status: 'CANCELLED' }),
      ]),
    ).toEqual({ completed: 0, signed: 0, ready: 0, remaining: 0 });
  });

  it('distinguishes signed, reviewable and failed records without hiding unfinished work', () => {
    expect(
      buildMindTodayProgress([
        session({ therapyNote: signedNote }),
        session({ therapyNote: { ...signedNote, locked: false } }),
        session({ noteDraft: { status: 'FAILED' } }),
      ]),
    ).toEqual({ completed: 3, signed: 1, ready: 1, remaining: 2 });
  });
});
