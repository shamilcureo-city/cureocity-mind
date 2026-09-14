import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  report: null as null | ((source: string, status: unknown) => void),
  effects: [] as (() => void | (() => void))[],
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useContext: () => harness.report,
  useId: () => 'status-source',
  useMemo: <T>(create: () => T) => create(),
  useEffect: (effect: () => void | (() => void)) => {
    harness.effects.push(effect);
  },
}));
import {
  sameMindCloseoutTaskStatus,
  summarizeMindCloseoutTaskStatus,
  useMindCloseoutTaskStatus,
} from './mind-closeout-task-status';

beforeEach(() => {
  harness.report = null;
  harness.effects = [];
});

describe('closeout status-only reporting', () => {
  it('does nothing outside a closeout boundary', () => {
    expect(() => {
      useMindCloseoutTaskStatus({ dirty: true, busy: true, needsAttention: false });
      harness.effects.forEach((run) => run()?.());
    }).not.toThrow();
  });

  it('reports metadata and removes only that source on unmount', () => {
    const report = vi.fn();
    harness.report = report;
    useMindCloseoutTaskStatus({ dirty: true, busy: false, needsAttention: true, uncertain: true });
    const cleanup = harness.effects.map((run) => run());
    expect(report).toHaveBeenCalledWith('status-source', {
      dirty: true,
      busy: false,
      needsAttention: true,
      uncertain: true,
    });
    expect(Object.keys(report.mock.calls[0][1])).toEqual([
      'dirty',
      'busy',
      'needsAttention',
      'uncertain',
    ]);
    cleanup.forEach((run) => run?.());
    expect(report).toHaveBeenLastCalledWith('status-source', null);
  });

  it('keeps an agreement error separate from an active homework save', () => {
    expect(
      summarizeMindCloseoutTaskStatus({
        agreement: { dirty: true, busy: false, needsAttention: true },
        homework: { dirty: true, busy: true, needsAttention: false },
      }),
    ).toEqual({ dirty: true, busy: true, needsAttention: true, uncertain: false });
  });

  it('does not trigger another parent update for identical metadata', () => {
    expect(
      sameMindCloseoutTaskStatus(
        { dirty: false, busy: false, needsAttention: false },
        { dirty: false, busy: false, needsAttention: false, uncertain: false },
      ),
    ).toBe(true);
    expect(
      sameMindCloseoutTaskStatus(undefined, { dirty: false, busy: false, needsAttention: false }),
    ).toBe(false);
    expect(
      sameMindCloseoutTaskStatus(
        { dirty: false, busy: false, needsAttention: false },
        { dirty: true, busy: false, needsAttention: false },
      ),
    ).toBe(false);
  });
});
