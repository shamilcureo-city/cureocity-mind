import type { NextRequest } from 'next/server';
import { requireScribeDoctor, scribeErrorResponse } from '@/lib/scribe-workspace-auth';
import { getScribeRecord } from '@/lib/scribe-workspace-store';
import { ReportBodySchema } from '@/lib/scribe-report-schema';
import { ScribeDocumentError } from '@/lib/scribe-document-errors';
import { prisma } from '@/lib/prisma';
import { lockActiveClient } from '@/lib/phi-write-lock';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireScribeDoctor(req);
  if (!auth.ok) return auth.response;
  try {
    const record = await getScribeRecord(
      { psychologistId: auth.value.psychologistId, kind: 'report' },
      (await context.params).id,
      ReportBodySchema,
    );
    if (!record?.clientId) throw new ScribeDocumentError(404, 'Report not found.');
    const clientId = record.clientId;
    await prisma.$transaction(async (tx) => {
      await lockActiveClient(tx, clientId, auth.value.psychologistId);
      const fresh = await tx.scribeWorkspaceRecord.findFirst({
        where: {
          id: record.id,
          revision: record.revision,
          psychologistId: auth.value.psychologistId,
          kind: 'report',
          clientId,
        },
        select: { id: true },
      });
      if (!fresh)
        throw new ScribeDocumentError(409, 'Report changed. Reload before opening the original.');
      await writeAudit(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: auth.value.psychologistId,
          action: 'CLIENT_VIEWED',
          targetType: 'Client',
          targetId: clientId,
          metadata: {
            ...auditMetadataFromRequest(req),
            surface: 'scribe_report_original',
            recordId: record.id,
            revision: record.revision,
          },
        },
        tx,
      );
    });
    const original = record.body.original;
    const extension =
      original.mime === 'application/pdf' ? 'pdf' : original.mime === 'image/png' ? 'png' : 'jpg';
    return new Response(new Uint8Array(Buffer.from(original.base64, 'base64')), {
      headers: {
        'Content-Type': original.mime,
        'Content-Disposition': `inline; filename="report.${extension}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "sandbox; default-src 'none'; frame-ancestors 'self'",
        'Referrer-Policy': 'no-referrer',
      },
    });
  } catch (error) {
    return scribeErrorResponse(error);
  }
}
