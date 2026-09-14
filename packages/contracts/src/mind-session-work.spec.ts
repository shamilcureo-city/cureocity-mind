import { describe, expect, it } from 'vitest';
import { MindCareRecordBodySchema, MindSessionWorkSchema } from './mind-care-record';

const legacy = {
  version: 'V1',
  agreement: {
    scope: '',
    confidentialityAndLimits: '',
    practicalArrangements: '',
    contactAndCrisisArrangements: '',
    clientPriorities: '',
    discussedOn: null,
    reviewOn: null,
  },
  clientVoice: {
    recordedOn: null,
    whatHelped: '',
    whatCouldChange: '',
    everydayChanges: '',
    clinicianReflection: '',
  },
  continuity: {
    stage: 'NOT_PLANNED',
    maintenancePlan: '',
    warningSignsAndResponse: '',
    endingOrReferralPlan: '',
    referralFollowThrough: '',
    reviewOn: null,
  },
};
const work = {
  sessionId: 'fictional-visit',
  scheduledAt: '2026-09-13T10:00:00.000Z',
  disposition: 'USED',
  workDone: 'Fictional clinician-authored work',
  clientResponse: '',
};
describe('additive encrypted session-work record', () => {
  it('decodes old V1 records unchanged without inventing delivery', () => {
    expect(MindCareRecordBodySchema.parse(legacy)).toEqual(legacy);
    expect(MindCareRecordBodySchema.parse(legacy).sessionWork).toBeUndefined();
  });
  it.each(['USED', 'ADAPTED', 'PAUSED', 'NOT_USED'])(
    'accepts explicit %s with response left unknown',
    (disposition) => {
      expect(
        MindCareRecordBodySchema.parse({ ...legacy, sessionWork: { ...work, disposition } })
          .sessionWork?.clientResponse,
      ).toBe('');
    },
  );
  it('does not accept guide reading as delivered therapy or missing source attribution', () => {
    const { clientResponse: _omitted, ...unknownResponse } = work;
    expect(MindSessionWorkSchema.parse(unknownResponse).clientResponse).toBe('');
    expect(MindSessionWorkSchema.safeParse({ ...work, disposition: 'GUIDE_READ' }).success).toBe(
      false,
    );
    expect(MindSessionWorkSchema.safeParse({ ...work, sessionId: '' }).success).toBe(false);
    expect(MindSessionWorkSchema.safeParse({ ...work, workDone: ' ' }).success).toBe(false);
    expect(MindSessionWorkSchema.safeParse({ ...work, automaticallyDelivered: true }).success).toBe(
      false,
    );
    expect(MindCareRecordBodySchema.safeParse({ ...legacy, sessionWork: null }).success).toBe(
      false,
    );
  });
});
