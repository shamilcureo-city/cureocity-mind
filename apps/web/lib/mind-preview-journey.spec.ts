import { describe, expect, it } from 'vitest';
import { initialMindPreview, reduceMindPreview } from './mind-preview-journey';

describe('fictional Mind walkthrough, not a capture or persistence test', () => {
  it('does not start the simulation without its explicit preparation choice', () => {
    expect(reduceMindPreview(initialMindPreview, { type: 'start' })).toEqual(initialMindPreview);
  });

  it('models pause/resume without losing the selected session state', () => {
    let state = reduceMindPreview(initialMindPreview, { type: 'consent', value: true });
    state = reduceMindPreview(state, { type: 'start' });
    expect(state.phase).toBe('recording');
    state = reduceMindPreview(state, { type: 'pause' });
    expect(state).toEqual({ consent: true, phase: 'paused' });
    state = reduceMindPreview(state, { type: 'resume' });
    expect(state.phase).toBe('recording');
    expect(reduceMindPreview(state, { type: 'finish' }).phase).toBe('draft');
  });

  it('cannot pretend an interrupted capture is a finished draft', () => {
    const state = reduceMindPreview({ consent: true, phase: 'recording' }, { type: 'interrupt' });
    expect(reduceMindPreview(state, { type: 'finish' })).toEqual(state);
    expect(reduceMindPreview(state, { type: 'resume' }).phase).toBe('recording');
  });

  it('resets the simulated consent rather than carrying it to a new session', () => {
    expect(reduceMindPreview({ consent: true, phase: 'draft' }, { type: 'reset' })).toEqual(
      initialMindPreview,
    );
    expect(initialMindPreview).toEqual({ consent: false, phase: 'ready' });
  });
});
