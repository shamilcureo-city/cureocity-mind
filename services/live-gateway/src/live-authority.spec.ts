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
  'CHRONIC_CARE',
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

  beforeEach(() => {
    fetchImpl.mockReset();
    close.mockReset();
    updateCapabilities.mockReset();
  });

  function authority() {
    return new LiveAuthority({
      sessionId: 'session-opaque-id',
      psychologistId: 'practitioner-opaque-id',
      tokenExpiresAt: 2_000_000_000,
      vertical: 'DOCTOR',
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

  it('closes as soon as the verified connection token expires even when the verifier stays active', async () => {
    fetchImpl.mockResolvedValue(response());
    let now = 1_999_999_999_000;
    const auth = new LiveAuthority({
      sessionId: 'session-opaque-id',
      psychologistId: 'practitioner-opaque-id',
      tokenExpiresAt: 2_000_000_000,
      vertical: 'DOCTOR',
      requiredCapabilities: REQUIRED,
      verifierUrl: 'https://web.internal/api/v1/internal/live-authority',
      serviceSecret: 'shared-secret',
      fetchImpl,
      now: () => now,
      close,
      updateCapabilities,
    });

    await expect(auth.authorizeEvent(noteEvent())).resolves.toEqual(noteEvent());
    now = 2_000_000_000_000;
    expect(auth.authorizeInput()).toBe(false);
    await expect(auth.authorizeEvent(noteEvent())).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledWith('live_authority_denied');
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

  it('revalidates current consent and authority immediately before accepting each input', async () => {
    fetchImpl.mockResolvedValue(response([], false));
    const auth = authority();

    await expect(auth.authorizeCurrentInput()).resolves.toBe(false);
    expect(close).toHaveBeenCalledWith('live_authority_denied');
  });

  it('sends only opaque authorization identifiers, immutable token claims, and the service secret', async () => {
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
          tokenExpiresAt: 2_000_000_000,
          vertical: 'DOCTOR',
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

  it.each([
    [
      { type: 'command', command: { kind: 'ADD_MEDICATION', raw: 'add x', drug: 'x' } },
      'PRESCRIPTION_DRAFTING',
    ],
    [
      { type: 'command', command: { kind: 'ORDER_TEST', raw: 'order x', description: 'x' } },
      'CLINICAL_ORDERS',
    ],
    [
      { type: 'command', command: { kind: 'SHOW_DATA', raw: 'show bp', measure: 'BP' } },
      'CHRONIC_CARE',
    ],

    [
      { type: 'gap', gap: { kind: 'DRUG_INTERACTION', severity: 'warn', message: 'x' } },
      'PRESCRIPTION_DRAFTING',
    ],
    [
      { type: 'gap', gap: { kind: 'RED_FLAG', severity: 'critical', message: 'x' } },
      'CLINICAL_ANALYSIS',
    ],
  ] as const)('authorizes queued %o output against %s', async (rawEvent, capability) => {
    const event = rawEvent as LiveGatewayEvent;
    fetchImpl
      .mockResolvedValueOnce(response(['LIVE_ENCOUNTER', 'MEDICAL_DOCUMENTATION']))
      .mockResolvedValueOnce(response(['LIVE_ENCOUNTER', 'MEDICAL_DOCUMENTATION', capability]));
    const auth = authority();

    await expect(auth.authorizeEvent(event)).resolves.toBeNull();
    await expect(auth.authorizeEvent(event)).resolves.toEqual(event);
  });

  it('allows queue-control commands only through the mandatory live authority', async () => {
    const event = {
      type: 'command',
      command: { kind: 'NEXT_PATIENT', raw: 'next', hold: false },
    } as LiveGatewayEvent;
    fetchImpl.mockResolvedValue(response(['LIVE_ENCOUNTER', 'MEDICAL_DOCUMENTATION']));

    await expect(authority().authorizeEvent(event)).resolves.toEqual(event);
  });
});
