import { NextResponse, type NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import {
  AdministerInstrumentInputSchema,
  ClinicalLocaleSchema,
  ListInstrumentResponsesQuerySchema,
  type ClinicalLocale,
} from '@cureocity/contracts';
import { INSTRUMENTS, InstrumentScoringError, scoreInstrument } from '@cureocity/clinical';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { toInstrumentResponse } from '@/lib/clinical-mappers';
import { prisma } from '@/lib/prisma';
import { parseJson, parseQuery } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/clients/[id]/instruments
 *
 * Administer + score an instrument (PHQ-9 or GAD-7) for a client.
 * The route validates the response map against the catalogue, scores
 * deterministically, and persists the row + audit. The Clinical Brief
 * + Pre-Session Brief read from this trend.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: clientId } = await params;
  const body = await parseJson(req, AdministerInstrumentInputSchema);
  if (!body.ok) return body.response;

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: {
      id: true,
      psychologistId: true,
      preferredLanguage: true,
      deletedAt: true,
    },
  });
  if (!client || client.psychologistId !== auth.value.psychologistId || client.deletedAt !== null) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  const definition = INSTRUMENTS[body.value.instrumentKey];
  if (!definition) {
    return NextResponse.json({ error: 'Unknown instrument' }, { status: 400 });
  }

  const language: ClinicalLocale =
    body.value.language ??
    (ClinicalLocaleSchema.safeParse(client.preferredLanguage).success
      ? (client.preferredLanguage as ClinicalLocale)
      : 'en');

  let scored;
  try {
    scored = scoreInstrument(definition, body.value.responses, language);
  } catch (e) {
    if (e instanceof InstrumentScoringError) {
      return NextResponse.json({ error: e.message }, { status: 422 });
    }
    throw e;
  }

  const now = new Date();
  const row = await prisma.instrumentResponse.create({
    data: {
      clientId,
      psychologistId: auth.value.psychologistId,
      ...(body.value.sessionId && { sessionId: body.value.sessionId }),
      instrumentKey: definition.key,
      language,
      responses: body.value.responses as unknown as Prisma.InputJsonValue,
      score: scored.score,
      severity: scored.severityKey,
      administeredAt: now,
      administeredByPsychologistId: auth.value.psychologistId,
      ...(body.value.notes !== undefined && { notes: body.value.notes }),
    },
  });

  await writeAudit({
    actorType: 'PSYCHOLOGIST',
    actorPsychologistId: auth.value.psychologistId,
    action: 'INSTRUMENT_ADMINISTERED',
    targetType: 'InstrumentResponse',
    targetId: row.id,
    metadata: {
      ...auditMetadataFromRequest(req),
      clientId,
      instrumentKey: definition.key,
      score: scored.score,
      severity: scored.severityKey,
      riskFlagged: scored.riskFlagged,
      language,
    },
  });

  return NextResponse.json({ response: toInstrumentResponse(row), risk: scored.riskFlagged });
}

/**
 * GET /api/v1/clients/[id]/instruments — list administrations, newest first.
 * Optional ?instrumentKey filter narrows to a single screener for trend display.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: clientId } = await params;
  const query = parseQuery(req.url, ListInstrumentResponsesQuerySchema);
  if (!query.ok) return query.response;

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, psychologistId: true, deletedAt: true },
  });
  if (!client || client.psychologistId !== auth.value.psychologistId || client.deletedAt !== null) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  const rows = await prisma.instrumentResponse.findMany({
    where: {
      clientId,
      psychologistId: auth.value.psychologistId,
      ...(query.value.instrumentKey && { instrumentKey: query.value.instrumentKey }),
    },
    orderBy: { administeredAt: 'desc' },
    take: query.value.limit,
  });

  if (rows.length > 0) {
    await writeAudit({
      actorType: 'PSYCHOLOGIST',
      actorPsychologistId: auth.value.psychologistId,
      action: 'INSTRUMENT_VIEWED',
      targetType: 'Client',
      targetId: clientId,
      metadata: {
        ...auditMetadataFromRequest(req),
        ...(query.value.instrumentKey !== undefined && { instrumentKey: query.value.instrumentKey }),
        rowCount: rows.length,
      },
    });
  }

  return NextResponse.json({ items: rows.map(toInstrumentResponse) });
}
