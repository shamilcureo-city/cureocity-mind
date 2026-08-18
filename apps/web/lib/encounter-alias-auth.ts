import type { NextRequest } from 'next/server';
import { requireCapability as requireSingleCapability } from './auth-server';
import {
  regulatedPolicyForRequest,
  resolveRegulatedRequirements,
} from './regulated-route-capabilities';

/** Enforce the union of an Encounter alias and its canonical Session policy. */
export async function requireCapability(req: NextRequest) {
  const policy = regulatedPolicyForRequest(new URL(req.url).pathname, req.method);
  if (!policy?.aliasOf) throw new Error('Encounter alias policy is missing');

  const required = resolveRegulatedRequirements(policy, 'DOCTOR');
  let resolved;
  for (const capability of required) {
    resolved = await requireSingleCapability(req, capability, resolved);
    if (!resolved.ok) return resolved;
  }
  if (!resolved) throw new Error('Encounter alias policy has no requirements');
  return resolved;
}
