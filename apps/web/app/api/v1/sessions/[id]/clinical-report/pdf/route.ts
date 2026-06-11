import { NextResponse, type NextRequest } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { ClinicalReportV1Schema } from '@cureocity/contracts';
import { ClinicalBriefPdf } from '@/components/pdf/ClinicalBriefPdf';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/sessions/[id]/clinical-report/pdf — Sprint 38.
 *
 * Renders the Clinical Brief (Pass 3 ClinicalReportV1) as a PDF. Only
 * TREATMENT / REVIEW reports parse as ClinicalReportV1; INTAKE sessions
 * store an InitialAssessmentBrief in `body` (different shape) and return
 * 404 here — their export is a separate template (tracked).
 *
 * Audited as CLINICAL_REPORT_GENERATED with `{ format: 'pdf' }` — same
 * verb as viewing the brief, the format is metadata.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse | Response> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await params;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { client: { select: { fullName: true } } },
  });
  if (!session || session.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  const reportRow = await prisma.clinicalReport.findUnique({ where: { sessionId } });
  if (!reportRow || reportRow.status !== 'COMPLETED' || !reportRow.body) {
    return NextResponse.json(
      { error: 'No completed clinical brief for this session yet.' },
      { status: 404 },
    );
  }
  const parsed = ClinicalReportV1Schema.safeParse(reportRow.body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          'This session uses an initial-assessment brief (intake), which has no PDF export yet.',
      },
      { status: 404 },
    );
  }

  const buffer = await renderToBuffer(
    ClinicalBriefPdf({
      report: parsed.data,
      clientFullName: session.client.fullName,
      sessionId: session.id,
      scheduledAt: session.scheduledAt.toISOString(),
      generatedAt: reportRow.updatedAt.toISOString(),
    }),
  );

  await writeAudit({
    actorType: 'PSYCHOLOGIST',
    actorPsychologistId: auth.value.psychologistId,
    action: 'CLINICAL_REPORT_GENERATED',
    targetType: 'ClinicalReport',
    targetId: reportRow.id,
    metadata: {
      ...auditMetadataFromRequest(req),
      sessionId: session.id,
      clientId: session.clientId,
      format: 'pdf',
      bytes: buffer.length,
    },
  });

  const dateStr = session.scheduledAt.toISOString().slice(0, 10);
  const safeName = session.client.fullName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const filename = `clinical-brief-${safeName}-${dateStr}.pdf`;

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'private, no-store',
    },
  });
}
