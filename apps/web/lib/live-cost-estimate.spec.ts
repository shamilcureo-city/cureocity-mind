import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MeterSummarySchema, type MeterSummary } from '@cureocity/contracts';
import { LiveCostEstimate } from '../components/app/LiveCostEstimate';

beforeAll(() => vi.stubGlobal('React', React));
afterAll(() => vi.unstubAllGlobals());
const summary = MeterSummarySchema.parse({
  sessionId: 'synthetic-cost',
  backend: 'vertex',
  windows: 12,
  pass1Calls: 12,
  pass2Calls: 2,
  inputTokens: 1000,
  outputTokens: 500,
  costInr: 2.27,
  transcriptP50Ms: 200,
  transcriptP95Ms: 300,
  noteP50Ms: 1000,
  noteP95Ms: 1100,
  elapsedMs: 60_000,
});
const render = (overrides: Partial<MeterSummary> = {}) =>
  renderToStaticMarkup(
    React.createElement(LiveCostEstimate, { summary: { ...summary, ...overrides } }),
  );

describe('live AI estimate explanation', () => {
  it('does not represent connection cost as an invoice or fixed per-minute rate', () => {
    const html = render();
    expect(html).toContain('Estimated AI processing');
    expect(html).toContain('₹2.27');
    expect(html).toContain('not a per-minute price');
    expect(html).toContain('not an invoice');
    expect(html).toContain('Actual provider billing may differ');
  });
  it('shows all three cost categories when supplied, with no invented historical breakdown', () => {
    const html = render({
      costBreakdown: { transcriptionInr: 0.6, notesInr: 1, reasoningInr: 0.67 },
    });
    expect(html).toContain('Transcription');
    expect(html).toContain('Note drafts');
    expect(html).toContain('Live suggestions');
    expect(html).toContain('₹0.67');
    expect(render()).not.toContain('<dl');
  });
  it('clearly labels local mock usage as simulated', () => {
    expect(render({ backend: 'mock' })).toContain('Simulated AI processing');
  });
});
