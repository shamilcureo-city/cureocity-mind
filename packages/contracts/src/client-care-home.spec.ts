import { describe, expect, it } from 'vitest';
import { CLIENT_CARE_HOME_ORDER, ClientCareHomeSchema } from './client-care-home';

describe('Sprint 5.5 client care home contract', () => {
  it('keeps the stable care-home information order', () => {
    expect(CLIENT_CARE_HOME_ORDER).toEqual([
      'WHAT_TO_DO_NEXT',
      'UPCOMING_SESSION',
      'HOMEWORK_CHECKINS',
      'GOALS_PROGRESS',
      'THERAPIST_RESOURCES',
      'HISTORY',
    ]);
  });

  it('rejects PII and unapproved clinical fields', () => {
    const result = ClientCareHomeSchema.safeParse({
      clientId: 'c123456789012345678901234',
      sections: CLIENT_CARE_HOME_ORDER.map((kind) => ({ kind, items: [] })),
      diagnosis: 'F32',
    });
    expect(result.success).toBe(false);
  });
});
