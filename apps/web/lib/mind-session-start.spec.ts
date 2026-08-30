import { describe, expect, it, vi } from 'vitest';
import { coordinateMindSessionStart, mindStartEntryHref } from './mind-session-start';

describe('Mind session start coordinator', () => {
  it('reuses the selected booked session and authorizes only after consent, preflight, and active capture', async () => {
    const events: string[] = [];
    const deps = {
      selectOrReuseSession: vi.fn(async () => {
        events.push('session');
        return { id: 'booked-1', status: 'SCHEDULED' as const };
      }),
      resolveConsent: vi.fn(async (id: string) => {
        events.push(`consent:${id}`);
        return { sessionId: id, snapshotRecorded: true };
      }),
      runPreflight: vi.fn(async () => {
        events.push('preflight');
        return { ready: true as const };
      }),
      activateCapture: vi.fn(async () => {
        events.push('capture');
        return { active: true as const };
      }),
      authorizeCapture: vi.fn(async (id: string) => {
        events.push(`authorize:${id}`);
      }),
    };

    await expect(
      coordinateMindSessionStart({ clientId: 'client-1', captureMode: 'LIVE' }, deps),
    ).resolves.toEqual({ sessionId: 'booked-1', resumed: false, captureMode: 'LIVE' });
    expect(events).toEqual([
      'session',
      'consent:booked-1',
      'preflight',
      'capture',
      'authorize:booked-1',
    ]);
  });

  it('returns to the same session after resolving missing consent', async () => {
    const deps = {
      selectOrReuseSession: vi.fn().mockResolvedValue({ id: 'same-session', status: 'SCHEDULED' }),
      resolveConsent: vi
        .fn()
        .mockResolvedValue({ sessionId: 'different-session', snapshotRecorded: true }),
      runPreflight: vi.fn(),
      activateCapture: vi.fn(),
      authorizeCapture: vi.fn(),
    };

    await expect(
      coordinateMindSessionStart({ clientId: 'client-1', captureMode: 'LIVE' }, deps),
    ).rejects.toMatchObject({ code: 'SESSION_CHANGED_DURING_CONSENT' });
    expect(deps.runPreflight).not.toHaveBeenCalled();
  });

  it('resumes an in-progress session without replacing it or clearing captured work', async () => {
    const deps = {
      selectOrReuseSession: vi.fn().mockResolvedValue({ id: 'running-1', status: 'IN_PROGRESS' }),
      resolveConsent: vi.fn(),
      runPreflight: vi.fn().mockResolvedValue({ ready: true }),
      activateCapture: vi.fn().mockResolvedValue({ active: true }),
      authorizeCapture: vi.fn(),
    };

    await expect(
      coordinateMindSessionStart({ clientId: 'client-1', captureMode: 'LIVE' }, deps),
    ).resolves.toEqual({ sessionId: 'running-1', resumed: true, captureMode: 'LIVE' });
    expect(deps.resolveConsent).not.toHaveBeenCalled();
    expect(deps.runPreflight).toHaveBeenCalledOnce();
    expect(deps.activateCapture).toHaveBeenCalledOnce();
    expect(deps.authorizeCapture).not.toHaveBeenCalled();
  });

  it('never authorizes or marks progress when capture activation fails', async () => {
    const deps = {
      selectOrReuseSession: vi.fn().mockResolvedValue({ id: 'session-1', status: 'SCHEDULED' }),
      resolveConsent: vi.fn().mockResolvedValue({ sessionId: 'session-1', snapshotRecorded: true }),
      runPreflight: vi.fn().mockResolvedValue({ ready: true }),
      activateCapture: vi
        .fn()
        .mockResolvedValue({ active: false, reason: 'Microphone permission denied' }),
      authorizeCapture: vi.fn(),
    };

    await expect(
      coordinateMindSessionStart({ clientId: 'client-1', captureMode: 'LIVE' }, deps),
    ).rejects.toMatchObject({ code: 'CAPTURE_NOT_ACTIVE' });
    expect(deps.authorizeCapture).not.toHaveBeenCalled();
  });

  it('routes every Mind entry source through the same preflight without changing Doctor URLs', () => {
    for (const source of ['TODAY', 'WALK_IN', 'RECORD', 'CLIENT'] as const) {
      expect(
        mindStartEntryHref({
          source,
          clientId: 'client-1',
          sessionId: 'session-1',
          captureMode: 'LIVE',
        }),
      ).toBe('/app?record=client-1&session=session-1&capture=LIVE');
    }
    expect(
      mindStartEntryHref({
        source: 'TODAY',
        clientId: 'patient-1',
        captureMode: 'LIVE',
        vertical: 'DOCTOR',
        doctorHref: '/app/patients/patient-1/encounters/enc-1/live',
      }),
    ).toBe('/app/patients/patient-1/encounters/enc-1/live');
  });
});
