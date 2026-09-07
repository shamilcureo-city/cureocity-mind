import { describe, expect, it } from 'vitest';
import { mindEntryContextForClient, mindSessionDestination } from './mind-session-start';

describe('Mind entry follows visit and client identity', () => {
  const session = { id: 'booking-a', clientId: 'client-a', status: 'SCHEDULED' };
  it('opens the selected booking in preparation, preserving preferred capture', () => {
    expect(mindSessionDestination(session, 'BATCH')).toBe(
      '/app?record=client-a&session=booking-a&capture=BATCH',
    );
  });
  it('resumes the exact active visit with its existing capture mode', () => {
    expect(mindSessionDestination({ ...session, status: 'IN_PROGRESS', captureMode: 'LIVE' })).toBe(
      '/app/sessions/booking-a/live',
    );
    expect(
      mindSessionDestination({ ...session, status: 'IN_PROGRESS', captureMode: 'BATCH' }),
    ).toBe('/app?record=client-a&session=booking-a&capture=BATCH');
  });
  it.each(['COMPLETED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED'])(
    'does not start a %s visit',
    (status) => {
      expect(mindSessionDestination({ ...session, status })).toBe(
        '/app/sessions/booking-a?tab=note',
      );
    },
  );
  it('retains exact booking and guide only for the selected initial client', () => {
    const initial = {
      initialClientId: 'client-a',
      initialSessionId: 'booking-a',
      initialGuideId: 'guide-a',
    };
    expect(mindEntryContextForClient({ ...initial, clientId: 'client-a' })).toEqual({
      sessionId: 'booking-a',
      guideId: 'guide-a',
    });
    expect(mindEntryContextForClient({ ...initial, clientId: 'client-b' })).toEqual({
      sessionId: null,
      guideId: undefined,
    });
    expect(
      mindEntryContextForClient({ ...initial, initialClientId: null, clientId: 'client-b' }),
    ).toEqual({ sessionId: null, guideId: undefined });
  });
});
