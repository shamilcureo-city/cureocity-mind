import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const source = readFileSync(
  new URL('../components/app/TherapistLiveSession.tsx', import.meta.url),
  'utf8',
);
describe('reviewed background acknowledgment wiring', () => {
  it('rejects old-socket messages and matches the pending request before accepting a receipt', () => {
    const incoming = source.slice(source.indexOf('ws.onmessage ='));
    expect(incoming.indexOf('if (!ownsSocket()) return;')).toBeLessThan(
      incoming.indexOf("case 'therapyContextReviewed':"),
    );
    expect(incoming).toContain('caseReply.current?.requestId === event.requestId');
  });
  it('invalidates snapshot identity and pending acknowledgments when the gateway clears authority', () => {
    const cleared = source.slice(
      source.indexOf("case 'therapyContextCleared':"),
      source.indexOf("case 'therapyContextReviewed':"),
    );
    expect(cleared).toContain('caseReply.current = null');
    expect(cleared).toContain('setAcknowledgedCaseKey(null)');
    expect(cleared).toContain("setCaseStatus('off')");
    expect(cleared).toContain('setCopilot(withoutContextDerivedReasoning)');
    expect(source).toContain('if (event.accepted) setCopilot(withoutContextDerivedReasoning)');
  });
  it('does not let an old connection close erase a newer connection acknowledgment', () => {
    const close = source.slice(source.indexOf('ws.onclose ='));
    expect(close.indexOf('if (!ownsSocket()) return;')).toBeLessThan(
      close.indexOf('setAcknowledgedCaseKey(null)'),
    );
    expect(source).toContain('acknowledgedCaseKey !== JSON.stringify(reviewContext)');
  });
});
