import { afterEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock('@sentry/nextjs', () => ({ captureException: h.capture }));
import { captureError } from './observability-sink';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  h.capture.mockReset();
});
describe('observability sink redaction', () => {
  it('does not send bearer URLs or clinical prose to logs, Sentry or webhooks', async () => {
    vi.stubEnv('OBSERVABILITY_WEBHOOK_URL', 'https://collector.example.test');
    const send = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', send);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const secret = 'fictionalPrivateCredential';
    await captureError(new Error(`Clinical content ${secret}`), {
      source: 'error-boundary',
      extra: { url: `https://mind.example.test/p/${secret}?sig=${secret}`, patient: secret },
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
    const error = h.capture.mock.calls[0]![0] as Error;
    expect(error.message).not.toContain(secret);
    expect(error.stack).toBeUndefined();
    expect(JSON.stringify(h.capture.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(send.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(send.mock.calls)).toContain('/p/[private]');
  });
});
