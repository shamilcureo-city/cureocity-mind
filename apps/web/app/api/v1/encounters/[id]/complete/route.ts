import { NextResponse, type NextRequest } from 'next/server';
import { EncounterApplicationError } from '@cureocity/orbit-core';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest } from '@/lib/audit';
import {
  encounterApplicationErrorResponse,
  encounterApplicationService,
  unwrapPrismaEncounter,
} from '@/lib/application/encounters';
import { toSession } from '@/lib/mappers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Canonical ORBIT Encounter completion adapter. */
export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: encounterId } = await ctx.params;
  try {
    const encounter = await encounterApplicationService.complete({
      encounterId,
      practitionerId: auth.value.psychologistId,
      auditMetadata: auditMetadataFromRequest(req),
    });
    return NextResponse.json(toSession(unwrapPrismaEncounter(encounter)));
  } catch (error) {
    if (!(error instanceof EncounterApplicationError)) throw error;
    const response = encounterApplicationErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
