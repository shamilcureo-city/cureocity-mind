import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MindInstrumentDraftState } from '@cureocity/contracts';

const harness = vi.hoisted(() => ({
  ref: undefined as { current: Set<string> } | undefined,
  queued: [] as (() => void)[],
}));
vi.mock('react', () => ({
  useRef: (value: Set<string>) => harness.ref ?? (harness.ref = { current: value }),
  useEffect: (effect: () => void) => harness.queued.push(effect),
}));
import { useSubmittedInstrumentRiskAlert } from './use-submitted-instrument-risk-alert';

const submitted: MindInstrumentDraftState = {
  instrumentKey: 'PHQ9',
  language: 'en',
  status: 'SUBMITTED',
  revision: 3,
  responses: {},
  submittedResponseId: 'fictional-scored-response',
  riskFlagged: true,
  updatedAt: '2026-09-10T00:00:00.000Z',
};
const notify = vi.fn();
function render(receipt: MindInstrumentDraftState | null, clientId = 'fictional-client') {
  useSubmittedInstrumentRiskAlert(clientId, receipt, notify);
  for (const effect of harness.queued.splice(0)) effect();
}

beforeEach(() => {
  harness.ref = undefined;
  harness.queued = [];
  notify.mockReset();
});

describe('submitted questionnaire safety alert recovery', () => {
  it('restores a persisted flagged receipt after loading, without submitting any answers', () => {
    render(null);
    expect(notify).not.toHaveBeenCalled();
    render(submitted);
    expect(notify).toHaveBeenCalledWith({ instrumentKey: 'PHQ9', itemNumber: 9 });
  });

  it('respects dismissal for the same receipt, but a fresh reload restores it', () => {
    render(submitted);
    notify.mockClear();
    render({ ...submitted });
    expect(notify).not.toHaveBeenCalled();
    harness.ref = undefined; // Remount after a full page reload; no browser storage.
    render(submitted);
    expect(notify).toHaveBeenCalledOnce();
  });

  it('never clears an existing warning when starting a new draft or scoring an unflagged measure', () => {
    render(submitted);
    notify.mockClear();
    render({ ...submitted, status: 'ACTIVE', riskFlagged: false, submittedResponseId: null });
    render({ ...submitted, instrumentKey: 'GAD7', riskFlagged: false });
    expect(notify).not.toHaveBeenCalled();
    render(submitted);
    expect(notify).not.toHaveBeenCalled();
  });

  it('surfaces a new flagged submission while refusing an incomplete or discarded receipt', () => {
    render({ ...submitted, submittedResponseId: null });
    render({ ...submitted, status: 'DISCARDED' });
    expect(notify).not.toHaveBeenCalled();
    render(submitted);
    render({ ...submitted, submittedResponseId: 'new-fictional-response' });
    expect(notify).toHaveBeenCalledTimes(2);
  });
});
