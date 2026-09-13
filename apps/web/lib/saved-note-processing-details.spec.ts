import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SavedNoteProcessingDetails } from '../components/app/SavedNoteProcessingDetails';

beforeAll(() => vi.stubGlobal('React', React));
afterAll(() => vi.unstubAllGlobals());

const render = (costInr: string) =>
  renderToStaticMarkup(
    React.createElement(SavedNoteProcessingDetails, {
      costInr,
      chunkCount: 4,
      transcriptChars: 300,
      region: 'signed',
    }),
  );

describe('saved note processing details', () => {
  it('labels the stored value as a partial estimate, not a tariff or invoice', () => {
    const html = render('2.27');
    expect(html).toContain('₹2.27');
    expect(html).toContain('Saved AI estimate');
    expect(html).toContain('not a whole-session bill or a per-minute price');
    expect(html).toContain('may exclude live connections');
    expect(html).toContain('Transcript turns');
    expect(html).not.toContain('Audio segments');
    expect(html).not.toContain('<details open');
    expect(html).toContain('print:hidden');
  });
  it.each(['0', '0.00', '', '—', 'NaN', 'Infinity', '-1'])(
    'does not infer free or known usage from %j',
    (value) => {
      const html = render(value);
      expect(html).toContain('Not available');
      expect(html).not.toContain('₹');
      expect(html).toContain('does not establish free processing');
    },
  );
});
