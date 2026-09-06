import { describe, expect, it } from 'vitest';
import {
  clientCreationEntry,
  createdClientDestination,
  newWalkInClientHref,
} from './client-entry-intent';

describe('Mind new-client entry intent', () => {
  it('opens the first-run Add client link', () => {
    expect(clientCreationEntry({ new: '1' }).initiallyOpen).toBe(true);
    expect(clientCreationEntry({}).initiallyOpen).toBe(false);
  });
  it('preserves walk-in capture choice through creation and returns to session setup', () => {
    const href = newWalkInClientHref('BATCH');
    const query = Object.fromEntries(new URL(href, 'https://example.test').searchParams);
    expect(clientCreationEntry(query)).toEqual({
      initiallyOpen: true,
      returnToSession: true,
      captureMode: 'BATCH',
    });
    expect(createdClientDestination('client-1', 'BATCH')).toBe(
      '/app/encounters/new?record=client-1&capture=BATCH',
    );
  });
  it('rejects arbitrary return destinations and encodes identifiers', () => {
    expect(clientCreationEntry({ returnTo: 'https://evil.test' }).returnToSession).toBe(false);
    expect(createdClientDestination('a&capture=LIVE', 'BATCH')).toContain(
      'record=a%26capture%3DLIVE',
    );
  });
});
