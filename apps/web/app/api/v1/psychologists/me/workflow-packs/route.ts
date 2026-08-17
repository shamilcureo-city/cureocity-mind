import { NextResponse, type NextRequest } from 'next/server';
import {
  activeWorkflowPacks,
  materializeWorkflowPack,
  ORBIT_WORKFLOW_PACKS,
} from '@cureocity/orbit-core';
import { requirePsychologistId } from '@/lib/auth-server';
import { getEffectiveCapabilities, serializeCapabilities } from '@/lib/capabilities';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/psychologists/me/workflow-packs — effective ORBIT pack manifests. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const effective = await getEffectiveCapabilities(auth.value.psychologistId);
  const capabilities = serializeCapabilities(effective);
  const packs = activeWorkflowPacks(capabilities, ORBIT_WORKFLOW_PACKS).map((pack) =>
    materializeWorkflowPack(pack, capabilities),
  );
  return NextResponse.json({ packs });
}
