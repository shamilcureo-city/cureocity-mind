import { describe, expect, it } from 'vitest';
import {
  MIND_CLOSEOUT_ARTEFACTS,
  choosePersistedDeliveryChannel,
  homeworkResponseDetail,
  mindCloseoutOptions,
} from './mind-care-loop';

describe('Sprint 5.1 Mind outcome-oriented closeout', () => {
  it('offers outcome artefacts before the secondary signed note and channel choice', () => {
    expect(MIND_CLOSEOUT_ARTEFACTS.map((item) => item.label)).toEqual([
      'Session takeaway',
      'Homework',
      'Next-session check-in',
      'Treatment-plan update',
      'Full signed note',
    ]);
    expect(MIND_CLOSEOUT_ARTEFACTS.at(-1)?.secondary).toBe(true);
    expect(mindCloseoutOptions('THERAPIST').steps).toEqual(['ARTEFACT', 'CHANNEL']);
    expect(mindCloseoutOptions('THERAPIST').completionOptions).toContain('DO_NOT_SEND');
  });

  it('labels every explicit client homework outcome for Today', () => {
    expect(homeworkResponseDetail({ outcome: 'DONE' })).toBe('Homework marked done');
    expect(homeworkResponseDetail({ outcome: 'PARTLY' })).toBe('Homework marked partly done');
    expect(homeworkResponseDetail({ outcome: 'NOT_YET' })).toBe('Homework marked not yet');
    expect(homeworkResponseDetail(null)).toBe('Homework response received');
  });

  it('fails closed for Doctor', () => {
    expect(mindCloseoutOptions('DOCTOR')).toEqual({ enabled: false });
  });

  it('preselects only the latest successful persisted channel', () => {
    expect(
      choosePersistedDeliveryChannel([
        { channel: 'EMAIL', status: 'SENT', sentAt: '2026-08-01T00:00:00.000Z' },
        { channel: 'WHATSAPP', status: 'PERMANENT_FAILURE', sentAt: null },
        { channel: 'PORTAL_LINK', status: 'OPENED', sentAt: '2026-08-03T00:00:00.000Z' },
      ]),
    ).toBe('PORTAL_LINK');
  });
});
