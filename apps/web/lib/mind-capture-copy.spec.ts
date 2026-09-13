import { describe, expect, it } from 'vitest';
import { mindCaptureRetentionCopy } from './mind-capture-copy';

describe('capture-mode retention disclosure', () => {
  it('does not promise retained audio for the live streaming route', () => {
    const copy = mindCaptureRetentionCopy({ mode: 'live-capture', method: 'mic', capture: 'live' });
    expect(copy).toContain('does not keep an audio recording');
    expect(copy).toContain('missing speech cannot be recovered');
    expect(copy).not.toContain('30 days');
  });
  it.each([
    { mode: 'upload' as const, method: 'mic', capture: 'live' as const },
    { mode: 'dictation' as const, method: 'dictation', capture: 'live' as const },
    { mode: 'live-capture' as const, method: 'mic', capture: 'batch' as const },
    { mode: 'live-capture' as const, method: 'display', capture: 'live' as const },
    { mode: 'live-capture' as const, method: 'room', capture: 'live' as const },
  ])('uses recorded-audio policy for $mode/$method/$capture', (input) => {
    expect(mindCaptureRetentionCopy(input)).toContain('the practice’s retention settings');
    expect(mindCaptureRetentionCopy(input)).not.toContain('30 days');
    expect(mindCaptureRetentionCopy(input)).not.toContain('does not keep an audio recording');
  });
});
