import { NextResponse, type NextRequest } from 'next/server';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { FhirExportError, buildEncounterFhir } from '@/lib/fhir-export';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sprint DV8.1 — GET /api/v1/sessions/:id/fhir
 *
 * Export the signed encounter (note + confirmed Rx + orders) as a FHIR R4
 * document Bundle — the ABDM-ready interoperability artifact. Tenant-
 * checked; audits the data egress.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await params;

  let result;
  try {
    result = await buildEncounterFhir(sessionId, auth.value.psychologistId);
  } catch (e) {
    if (e instanceof FhirExportError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 409 });
    }
    throw e;
  }
  if (!result) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  await writeAudit({
    actorType: 'PSYCHOLOGIST',
    actorPsychologistId: auth.value.psychologistId,
    action: 'ENCOUNTER_FHIR_EXPORTED',
    targetType: 'Session',
    targetId: sessionId,
    metadata: {
      sessionId,
      clientId: result.clientId,
      resourceCount: result.bundle.entry.length,
      ...auditMetadataFromRequest(req),
    },
  });

  return NextResponse.json(result.bundle, {
    headers: {
      'content-type': 'application/fhir+json',
      'content-disposition': `attachment; filename="encounter-${sessionId}.fhir.json"`,
    },
  });
}
