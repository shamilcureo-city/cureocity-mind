import { describe, expect, it } from 'vitest';
import { addCreatedClientOption } from './schedule-client-options';

describe('Mind scheduling client options', () => {
  it('adds a newly created client to an empty scheduling roster', () => {
    expect(
      addCreatedClientOption([], {
        id: 'client-new',
        fullName: 'Asha Nair',
        preferredModality: null,
      }),
    ).toEqual([
      {
        id: 'client-new',
        fullName: 'Asha Nair',
        preferredModality: null,
      },
    ]);
  });

  it('replaces an existing option instead of duplicating the client', () => {
    expect(
      addCreatedClientOption([{ id: 'client-1', fullName: 'Old name', preferredModality: 'CBT' }], {
        id: 'client-1',
        fullName: 'Updated name',
        preferredModality: null,
      }),
    ).toEqual([{ id: 'client-1', fullName: 'Updated name', preferredModality: null }]);
  });
});
