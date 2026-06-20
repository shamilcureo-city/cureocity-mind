import { NextResponse, type NextRequest } from 'next/server';
import { AbdmPushInputSchema, type AbdmPushResult } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { abdmProvider } from '@/lib/abdm';
import { FhirExportError, buildEncounterFhir } from '@/lib/fhir-export';
import { parseJson } from '@/lib/validate';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sprint DV8.2 — POST /api/v1/sessions/:id/abdm/push
 *
 * Push the signed encounter's prescription (as a FHIR Bundle) to the
 * patient's ABDM PHR. Links the ABHA address if supplied (persisted on
 * the patient + audited). The real gateway call is env-gated; the mock
 * provider completes the flow in dev. Tenant-checked.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await params;

  const parsed = await parseJson(req, AbdmPushInputSchema);
  if (!parsed.ok) return parsed.response;

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

  // Resolve the ABHA: the request links a new one (persist + audit), else
  // we use the patient's already-linked address.
  let abhaAddress = result.abhaAddress;
  if (parsed.value.abhaAddress && parsed.value.abhaAddress !== result.abhaAddress) {
    abhaAddress = parsed.value.abhaAddress;
    await prisma.client.update({
      where: { id: result.clientId },
      data: { abhaAddress },
    });
    await writeAudit({
      actorType: 'PSYCHOLOGIST',
      actorPsychologistId: auth.value.psychologistId,
      action: 'ABHA_LINKED',
      targetType: 'Client',
      targetId: result.clientId,
      metadata: { sessionId, ...auditMetadataFromRequest(req) },
    });
  }
  if (!abhaAddress) {
    return NextResponse.json(
      { error: 'Link the patient’s ABHA address before pushing to their PHR.', code: 'NO_ABHA' },
      { status: 409 },
    );
  }

  // Rebuild the bundle so the ABHA just linked rides on the Patient
  // resource (the first build may have had no ABHA on file).
  const fresh = await buildEncounterFhir(sessionId, auth.value.psychologistId);
  const bundle = fresh?.bundle ?? result.bundle;

  const provider = abdmProvider();
  const outcome = await provider.pushPrescription(bundle, {
    abhaAddress,
    patientName: result.patientName,
  });

  await writeAudit({
    actorType: 'PSYCHOLOGIST',
    actorPsychologistId: auth.value.psychologistId,
    action: 'ABDM_PRESCRIPTION_PUSHED',
    targetType: 'Session',
    targetId: sessionId,
    metadata: {
      sessionId,
      clientId: result.clientId,
      provider: outcome.provider,
      pushed: outcome.pushed,
      resourceCount: bundle.entry.length,
      ...auditMetadataFromRequest(req),
    },
  });

  const body: AbdmPushResult = {
    pushed: outcome.pushed,
    phrReference: outcome.phrReference,
    abhaAddress,
    provider: outcome.provider,
    resourceCount: bundle.entry.length,
  };
  return NextResponse.json(body);
}
