import type { LiveGatewayEvent, PractitionerCapability } from '@cureocity/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveAuthority } from './live-authority';

const REQUIRED = new Set<PractitionerCapability>(['LIVE_ENCOUNTER', 'MEDICAL_DOCUMENTATION']);
const ALL = [
  'LIVE_ENCOUNTER',
  'MEDICAL_DOCUMENTATION',
  'CLINICAL_ANALYSIS',
  'PRESCRIPTION_DRAFTING',
  'CLINICAL_ORDERS',
] as PractitionerCapability[];

const noteEvent = (): LiveGatewayEvent => ({ type: 'note', partial: {} });
const reasoningEvent = (): LiveGatewayEvent =>
  ({
    type: 'reasoning',
    reasoning: { differential: [], askNext: [], redFlags: [] },
  }) as unknown as LiveGatewayEvent;

function response(capabilities = ALL, authorized = true): Response {
  return new Response(JSON.stringify({ authorized, capabilities }), {
    status: authorized ? 200 : 403,
    headers: { 'content-type': 'application/json' },
  });
}

describe('continuous live authority', () => {
  const fetchImpl = vi.fn<typeof fetch>();
  const close = vi.fn();
  const updateCapabilities = vi.fn();

  beforeEach(() => vi.clearAllMocks());

  function authority(exp = Math.floor(Date.now() / 1000) + 60) {
    return new LiveAuthority({
      sessionId: 'session-opaque-id',
      psychologistId: 'practitioner-opaque-id',
      tokenExpiresAtSec: exp,
      requiredCapabilities: REQUIRED,
      verifierUrl: 'https://web.internal/api/v1/internal/live-authority',
      serviceSecret: 'shared-secret',
      fetchImpl,
      timeoutMs: 50,
      close,
      updateCapabilities,
    });
  }

  it.each(['revoked', 'inactive', 'deleted'])(
    'terminates post-connect output when authority is %s',
    async () => {
      fetchImpl.mockResolvedValue(response([], false));
      const auth = authority();

      await expect(auth.authorizeEvent(noteEvent())).resolves.toBeNull();
      expect(close).toHaveBeenCalledWith('live_authority_denied');
    },
  );

  it('terminates at token expiry without consulting a stale capability snapshot', async () => {
    const auth = authority(Math.floor(Date.now() / 1000) - 1);

    await expect(auth.authorizeEvent(noteEvent())).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledWith('live_token_expired');
  });

  it('dynamically suppresses optional outputs after downgrade while documentation continues', async () => {
    fetchImpl.mockImplementation(async () => response(['LIVE_ENCOUNTER', 'MEDICAL_DOCUMENTATION']));
    const auth = authority();

    await expect(auth.authorizeEvent(reasoningEvent())).resolves.toBeNull();
    await expect(auth.authorizeEvent(noteEvent())).resolves.toEqual(noteEvent());
    expect(updateCapabilities).toHaveBeenLastCalledWith(
      new Set(['LIVE_ENCOUNTER', 'MEDICAL_DOCUMENTATION']),
    );
    expect(close).not.toHaveBeenCalled();
  });

  it('fails closed on verifier timeout or outage', async () => {
    fetchImpl.mockRejectedValue(new Error('unavailable'));
    const auth = authority();

    await expect(auth.authorizeEvent(noteEvent())).resolves.toBeNull();
    expect(close).toHaveBeenCalledWith('live_authority_unavailable');
  });

  it('sends only opaque authorization identifiers and the service secret', async () => {
    fetchImpl.mockResolvedValue(response());
    const auth = authority();

    await auth.authorizeEvent(noteEvent());

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://web.internal/api/v1/internal/live-authority',
      expect.objectContaining({
        method: 'POST',
        redirect: 'error',
        headers: expect.objectContaining({ authorization: 'Bearer shared-secret' }),
        body: JSON.stringify({
          sessionId: 'session-opaque-id',
          psychologistId: 'practitioner-opaque-id',
        }),
      }),
    );
  });

  it('shares one in-flight verifier request across concurrent output checks', async () => {
    let resolveResponse!: (value: Response) => void;
    fetchImpl.mockImplementation(
      () => new Promise<Response>((resolve) => (resolveResponse = resolve)),
    );
    const auth = authority();

    const first = auth.authorizeEvent(noteEvent());
    const second = auth.authorizeEvent(noteEvent());
    expect(fetchImpl).toHaveBeenCalledOnce();

    resolveResponse(response());
    await expect(Promise.all([first, second])).resolves.toEqual([noteEvent(), noteEvent()]);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
