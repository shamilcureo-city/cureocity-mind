import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { SessionUsageSummarySchema } from '@cureocity/contracts';
import { SessionUsageDetails } from '../components/app/SessionUsagePanel';
beforeAll(() => vi.stubGlobal('React', React));
afterAll(() => vi.unstubAllGlobals());
const summary = SessionUsageSummarySchema.parse({
  version: 1,
  sessionId: 'fictional',
  recordedSubtotalInr: '2.2700',
  liveConnectionSubtotalInr: '2.0000',
  webCallSubtotalInr: '0.2700',
  legacySubtotalInr: null,
  lowerBound: false,
  coverage: 'PARTIAL',
  coverageReasons: ['Not reconciled with provider billing'],
  connections: { registered: 2, receipted: 2, open: 0, finalReported: 2, incomplete: 0 },
  webCallRecords: 1,
  legacyOverlap: 'NONE',
  usageBasis: 'RECORDED_ESTIMATE',
  reconciliation: 'NOT_RECONCILED',
});
const render = (patch = {}, stale = false) =>
  renderToStaticMarkup(
    React.createElement(SessionUsageDetails, { summary: { ...summary, ...patch }, stale }),
  );
describe('partial estimate, owner-friendly copy', () => {
  it('explains scope and distinguishes estimates from invoices, minutes and subscription charges', () => {
    const html = render();
    expect(html).toContain('₹2.27');
    expect(html).toContain('Live connection receipts (2 of 2)');
    expect(html).toContain('not an invoice or a per-minute price');
    expect(html).toContain('does not determine your subscription charges');
    expect(html).toContain('What this estimate covers');
    expect(html).toContain('Actual provider billing may differ');
  });
  it('shows overlap as lower bound without suggesting its source amounts can be added', () => {
    const html = render({
      lowerBound: true,
      legacyOverlap: 'UNPROVEN',
      legacySubtotalInr: '1.2700',
    });
    expect(html).toContain('At least ₹2.27');
    expect(html).toContain('only the larger live subtotal, not both');
    expect(html).toContain('lower bound, not a reconciled total');
  });
  it('does not turn absent usage or a sub-paise positive estimate into free processing', () => {
    const absent = render({ recordedSubtotalInr: null, liveConnectionSubtotalInr: null });
    expect(absent).toContain('Not recorded');
    expect(absent).not.toContain('Recorded subtotal: ₹0.00');
    expect(render({ recordedSubtotalInr: '0.0010' })).toContain('₹0.0010');
    expect(render({ recordedSubtotalInr: '0.0000' })).toContain('A zero receipt is recorded');
  });
  it('labels stale data rather than claiming a failed refresh is current', () => {
    expect(render({}, true)).toContain('Last available estimate');
  });
});
