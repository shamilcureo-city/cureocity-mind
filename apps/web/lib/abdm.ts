import type { FhirBundle } from '@cureocity/clinical';

/**
 * Sprint DV8.2 — ABDM PHR push adapter.
 *
 * Mirrors the notifications-adapter pattern (mock + real provider behind
 * an interface). `ABDM_BACKEND=mock` (default) completes the flow end-to-
 * end in dev; `ABDM_BACKEND=gateway` selects the real HIP/gateway
 * integration, which is env-gated on ABDM sandbox creds + HIP
 * registration (see docs/DOCTOR_VERTICAL_SPRINTS.md DV8.2). The push
 * route, audit, ABHA linking and FHIR bundle are all real today — only
 * the final gateway call is pending procurement.
 */

export interface AbdmPushContext {
  abhaAddress: string;
  patientName?: string;
}

export interface AbdmPushOutcome {
  pushed: boolean;
  /** PHR document reference from the gateway; null on mock. */
  phrReference: string | null;
  provider: string;
}

export interface AbdmProvider {
  readonly name: string;
  pushPrescription(bundle: FhirBundle, ctx: AbdmPushContext): Promise<AbdmPushOutcome>;
}

class MockAbdmProvider implements AbdmProvider {
  readonly name = 'mock';
  async pushPrescription(bundle: FhirBundle, ctx: AbdmPushContext): Promise<AbdmPushOutcome> {
    // Deterministic fake PHR reference so the dev flow completes without
    // a real gateway. Tagged so call analytics can filter mock pushes.
    return {
      pushed: true,
      phrReference: `phr-mock:${ctx.abhaAddress}:${bundle.entry.length}`,
      provider: 'mock',
    };
  }
}

class GatewayAbdmProvider implements AbdmProvider {
  readonly name = 'gateway';
  async pushPrescription(): Promise<AbdmPushOutcome> {
    // The real ABDM flow (consent artefact → /health-information/ push of
    // the FHIR Bundle to the patient's PHR via the HIP bridge) requires
    // ABDM sandbox creds + HIP registration. Throw until wired so we
    // never silently no-op a clinical data push.
    throw new Error(
      'ABDM gateway provider is not configured. Set ABDM_BACKEND=mock for dev, or wire the ABDM_* sandbox creds + HIP registration.',
    );
  }
}

export function abdmProvider(): AbdmProvider {
  return process.env['ABDM_BACKEND'] === 'gateway'
    ? new GatewayAbdmProvider()
    : new MockAbdmProvider();
}
