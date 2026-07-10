/**
 * Sprint TS-safety — the single source of truth for "is the mock LLM backend
 * allowed to run here?".
 *
 * The mock backends fabricate complete, plausible clinical output (transcripts,
 * SOAP/medical notes, differentials). Serving that to a real practitioner —
 * because `LLM_BACKEND` was unset or mistyped on a hosted deployment — is a
 * patient-safety incident. This policy makes mock **impossible in any deployed
 * environment** (Vercel preview AND production, Cloud Run), so a human only
 * ever sees real Vertex output or a loud failure — never a silent fake.
 *
 * Mock stays available for genuinely-local development (no deploy signals) so a
 * developer without GCP credentials can still exercise the UI; a deliberate
 * non-production demo can re-enable it on a preview with an explicit opt-in.
 * PRODUCTION never permits mock, opt-in or not.
 *
 * Both entry points that build a live backend — `apps/web/lib/llm.ts`
 * (batch pipeline) and `services/live-gateway/src/llm.ts` (live scribe) —
 * funnel their env through THIS function so there is one rule, not two that
 * can drift. Unit tests construct the mock backends directly and never reach
 * these builders, so this guard never fires under test.
 */

/** Thrown when the mock backend would be served somewhere it must not be. */
export class MockBackendRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MockBackendRefusedError';
  }
}

export interface BackendPolicyInput {
  /** The raw `LLM_BACKEND` env value (undefined when unset). */
  requested: string | undefined;
  /**
   * A hosted/deployed environment — a Vercel preview or production deploy, or
   * a Cloud Run container. Mock is refused here unless `allowMockOptIn` AND not
   * `production`.
   */
  deployed: boolean;
  /**
   * Specifically PRODUCTION. Mock is NEVER served here — the opt-in cannot
   * override it.
   */
  production: boolean;
  /**
   * `ALLOW_MOCK_LLM=true` — a deliberate escape hatch that permits mock on a
   * NON-production DEPLOYED environment (e.g. a preview demo). Ignored locally
   * (mock is already allowed) and in production (never allowed).
   */
  allowMockOptIn: boolean;
}

export type ResolvedBackend = 'vertex' | 'mock';

/**
 * Decide the backend, enforcing the no-mock-in-deployed-environments rule.
 * Returns `'vertex'` or `'mock'`, or throws {@link MockBackendRefusedError}
 * when mock would be served where it must not be.
 */
export function resolveLlmBackend(input: BackendPolicyInput): ResolvedBackend {
  if (input.requested === 'vertex') return 'vertex';

  // Anything other than the literal 'vertex' (unset / 'mock' / a typo) means
  // the mock backend — which we now gate hard on the environment.
  const value = input.requested ?? '<unset>';
  if (input.production) {
    throw new MockBackendRefusedError(
      `[llm] REFUSING the mock backend in PRODUCTION (LLM_BACKEND='${value}'). ` +
        `Real clinical output is required — set LLM_BACKEND=vertex with Vertex credentials. ` +
        `The mock backend fabricates clinical content and must never reach a patient or practitioner.`,
    );
  }
  if (input.deployed && !input.allowMockOptIn) {
    throw new MockBackendRefusedError(
      `[llm] REFUSING the mock backend on a deployed environment (LLM_BACKEND='${value}'). ` +
        `Set LLM_BACKEND=vertex, or set ALLOW_MOCK_LLM=true to deliberately permit a NON-production demo.`,
    );
  }
  return 'mock';
}

/**
 * Non-throwing companion for request handlers that want to return a clean
 * error instead of crashing: the refusal message when mock is not allowed
 * here, or `null` when the resolved backend is fine to use (vertex, or mock in
 * a permitted environment).
 */
export function mockRefusalReason(input: BackendPolicyInput): string | null {
  try {
    resolveLlmBackend(input);
    return null;
  } catch (e) {
    return e instanceof MockBackendRefusedError ? e.message : null;
  }
}
