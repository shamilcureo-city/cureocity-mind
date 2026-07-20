import { NextResponse, type NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import {
  CaseFormulationV1Schema,
  ClinicalReportV1Schema,
  SaveFormulationInputSchema,
  type CaseFormulationV1,
  type FormulationSuggestion,
} from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EMPTY_FORMULATION: CaseFormulationV1 = {
  version: 'V1',
  narrative: '',
  cycle: [],
  fivePs: { predisposing: [], precipitating: [], perpetuating: [], protective: [] },
  predictions: [],
};

/**
 * GET /api/v1/clients/[id]/formulation — the client's ACTIVE living
 * formulation (or null). Tenant-checked.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: clientId } = await params;

  const client = await prisma.client.findFirst({
    where: { id: clientId, psychologistId: auth.value.psychologistId, deletedAt: null },
    select: { id: true },
  });
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

  const row = await prisma.caseFormulation.findFirst({
    where: { clientId, supersededAt: null },
    orderBy: { version: 'desc' },
  });
  if (!row) return NextResponse.json({ formulation: null });

  const parsed = CaseFormulationV1Schema.safeParse(row.body);
  return NextResponse.json({
    formulation: parsed.success
      ? {
          id: row.id,
          version: row.version,
          confirmedAt: row.confirmedAt.toISOString(),
          body: parsed.data,
        }
      : null,
  });
}

/**
 * POST /api/v1/clients/[id]/formulation — confirm a new formulation version:
 * either ACCEPT one AI suggestion from a report's `formulationSuggestions`
 * (applied deterministically to the active body), or AUTHOR the whole body
 * directly. Supersedes the prior version; audited `FORMULATION_CONFIRMED`.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: clientId } = await params;

  const body = await parseJson(req, SaveFormulationInputSchema);
  if (!body.ok) return body.response;

  const client = await prisma.client.findFirst({
    where: { id: clientId, psychologistId: auth.value.psychologistId, deletedAt: null },
    select: { id: true },
  });
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

  const activeRow = await prisma.caseFormulation.findFirst({
    where: { clientId, supersededAt: null },
    orderBy: { version: 'desc' },
  });
  const activeParsed = activeRow ? CaseFormulationV1Schema.safeParse(activeRow.body) : null;
  const active: CaseFormulationV1 = activeParsed?.success ? activeParsed.data : EMPTY_FORMULATION;

  // Typed `unknown` because parseJson surfaces the schema's INPUT type
  // (defaults still optional); the safeParse below normalises to the
  // canonical output shape before anything is persisted.
  let next: unknown;
  let sourceSessionId: string | null = null;
  let source: 'SUGGESTION' | 'AUTHOR';

  if (body.value.action === 'accept') {
    const report = await prisma.clinicalReport.findFirst({
      where: { id: body.value.reportId, clientId, psychologistId: auth.value.psychologistId },
      select: { id: true, sessionId: true, body: true, status: true },
    });
    if (!report || report.status !== 'COMPLETED' || !report.body) {
      return NextResponse.json({ error: 'Clinical report not found' }, { status: 404 });
    }
    const parsedReport = ClinicalReportV1Schema.safeParse(report.body);
    if (!parsedReport.success) {
      return NextResponse.json(
        { error: 'Report has no formulation suggestions.' },
        { status: 409 },
      );
    }
    const suggestion = parsedReport.data.formulationSuggestions[body.value.suggestionIndex];
    if (!suggestion) {
      return NextResponse.json({ error: 'Suggestion index out of range.' }, { status: 422 });
    }
    next = applySuggestion(active, suggestion);
    sourceSessionId = report.sessionId;
    source = 'SUGGESTION';
  } else {
    next = body.value.formulation;
    source = 'AUTHOR';
  }

  const validated = CaseFormulationV1Schema.safeParse(next);
  if (!validated.success) {
    return NextResponse.json(
      { error: 'The change would produce an invalid formulation.' },
      { status: 422 },
    );
  }

  const confirmedAt = new Date();
  const created = await prisma.$transaction(async (tx) => {
    await tx.caseFormulation.updateMany({
      where: { clientId, supersededAt: null },
      data: { supersededAt: confirmedAt },
    });
    const max = await tx.caseFormulation.aggregate({
      where: { clientId },
      _max: { version: true },
    });
    const row = await tx.caseFormulation.create({
      data: {
        clientId,
        psychologistId: auth.value.psychologistId,
        sourceSessionId,
        version: (max._max.version ?? 0) + 1,
        body: validated.data as unknown as Prisma.InputJsonValue,
        confirmedAt,
      },
    });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'FORMULATION_CONFIRMED',
        targetType: 'CaseFormulation',
        targetId: row.id,
        metadata: { ...auditMetadataFromRequest(req), clientId, version: row.version, source },
      },
      tx,
    );
    return row;
  });

  return NextResponse.json({ ok: true, version: created.version }, { status: 200 });
}

/**
 * Deterministic application of one AI suggestion to the active body.
 * List targets: ADD pushes (exact-dupe-safe); REVISE replaces the closest
 * overlapping entry, else pushes. Narrative: REVISE replaces, ADD appends.
 */
function applySuggestion(f: CaseFormulationV1, s: FormulationSuggestion): CaseFormulationV1 {
  const next: CaseFormulationV1 = JSON.parse(JSON.stringify(f)) as CaseFormulationV1;
  const upsert = (list: string[]): string[] => {
    if (s.action === 'REVISE') {
      const i = list.findIndex(
        (e) => overlap(e, s.text) || e.toLowerCase().includes(s.text.slice(0, 24).toLowerCase()),
      );
      if (i >= 0) {
        list[i] = s.text;
        return list;
      }
    }
    if (!list.includes(s.text) && list.length < 8) list.push(s.text);
    return list;
  };
  switch (s.target) {
    case 'NARRATIVE':
      next.narrative =
        s.action === 'REVISE' || next.narrative === '' ? s.text : `${next.narrative}\n\n${s.text}`;
      break;
    case 'CYCLE': {
      const role = s.cycleRole ?? 'CONSEQUENCE';
      const i = next.cycle.findIndex((n) => n.role === role);
      if (s.action === 'REVISE' && i >= 0) next.cycle[i] = { ...next.cycle[i]!, text: s.text };
      else if (next.cycle.length < 8) next.cycle.push({ role, text: s.text, breaking: false });
      break;
    }
    case 'PREDISPOSING':
      next.fivePs.predisposing = upsert(next.fivePs.predisposing);
      break;
    case 'PRECIPITATING':
      next.fivePs.precipitating = upsert(next.fivePs.precipitating);
      break;
    case 'PERPETUATING':
      next.fivePs.perpetuating = upsert(next.fivePs.perpetuating);
      break;
    case 'PROTECTIVE':
      next.fivePs.protective = upsert(next.fivePs.protective);
      break;
    case 'PREDICTION': {
      const i = next.predictions.findIndex((p) => overlap(p.text, s.text));
      if (s.action === 'REVISE' && i >= 0)
        next.predictions[i] = { ...next.predictions[i]!, text: s.text };
      else if (next.predictions.length < 6)
        next.predictions.push({ text: s.text, status: 'TO_TEST' });
      break;
    }
  }
  return next;
}

/** Loose overlap check — first 24 chars of either string appear in the other. */
function overlap(a: string, b: string): boolean {
  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  return al.includes(bl.slice(0, 24)) || bl.includes(al.slice(0, 24));
}
