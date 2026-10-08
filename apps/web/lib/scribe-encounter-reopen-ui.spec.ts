import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MedicalEncounterNoteV1Schema } from '@cureocity/contracts';
const h = vi.hoisted(() => ({
  states: [] as unknown[],
  refs: [] as { current: unknown }[],
  effects: [] as boolean[],
  queued: [] as (() => void)[],
  stateIndex: 0,
  refIndex: 0,
  effectIndex: 0,
  load: vi.fn(),
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: <T>(initial: T | (() => T)) => {
    const i = h.stateIndex++;
    if (!(i in h.states))
      h.states[i] = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [
      h.states[i],
      (next: T) => {
        h.states[i] = next;
      },
    ];
  },
  useRef: <T>(current: T) => {
    const i = h.refIndex++;
    return h.refs[i] ?? (h.refs[i] = { current });
  },
  useCallback: <T>(fn: T) => fn,
  useEffect: (fn: () => void) => {
    const i = h.effectIndex++;
    if (!h.effects[i]) {
      h.effects[i] = true;
      h.queued.push(fn);
    }
  },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('../components/app/LiveRecorder', () => ({ LiveRecorder: 'recorder' }));
vi.mock('../components/app/FileUploadPanel', () => ({ FileUploadPanel: 'upload' }));
vi.mock('../components/app/ReviewAndSign', () => ({ ReviewAndSign: 'review' }));
vi.mock('./scribe-encounter-review', () => ({ loadScribeEncounterReview: h.load }));
import { DoctorEncounterPanel } from '../components/app/DoctorEncounterPanel';
const draft = MedicalEncounterNoteV1Schema.parse({
  version: 'V1',
  assessment: 'Original AI draft',
});
const corrected = { ...draft, assessment: 'Signed clinician correction' };
function render() {
  h.stateIndex = h.refIndex = h.effectIndex = 0;
  const result = DoctorEncounterPanel({
    sessionId: 's1',
    clientId: 'c1',
    clientName: 'Fictional patient',
    sessionStatus: 'COMPLETED',
  });
  h.queued.splice(0).forEach((run) => run());
  return result;
}
beforeEach(() => {
  vi.resetAllMocks();
  h.states = [];
  h.refs = [];
  h.effects = [];
  h.queued = [];
  vi.stubGlobal('React', React);
});
afterEach(() => vi.unstubAllGlobals());
describe('reopening the real doctor encounter component', () => {
  it('prefers the immutable corrected signed record to the original AI draft', async () => {
    h.load.mockResolvedValue({
      draft: { status: 'COMPLETED', content: draft, errorMessage: null },
      signedNote: { content: corrected, rxPad: null, signedAt: '2026-10-01T10:00:00Z' },
    });
    render();
    await vi.waitFor(() => expect(render().type).toBe('review'));
    expect(render().props).toMatchObject({ note: corrected, initialSigned: true });
  });
  it('keeps an explicitly reopened draft editable without reusing old signed status', async () => {
    h.load.mockResolvedValue({
      draft: { status: 'COMPLETED', content: corrected, errorMessage: null },
      signedNote: null,
    });
    render();
    await vi.waitFor(() => expect(render().type).toBe('review'));
    expect(render().props).toMatchObject({ note: corrected, initialSigned: false });
  });
  it('fails closed instead of rendering a draft when canonical status cannot be loaded', async () => {
    h.load.mockRejectedValue(new Error('Could not verify the saved encounter'));
    render();
    await vi.waitFor(() =>
      expect(JSON.stringify(render())).toContain('Could not verify the saved encounter'),
    );
    expect(render().type).not.toBe('review');
  });
});
