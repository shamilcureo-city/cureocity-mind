import { NextResponse, type NextRequest } from 'next/server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { requireCareUserId } from '@/lib/care-auth';
import { getCareCaseFile } from '@/lib/care-case-file';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * CG6 — GET /api/v1/care/export/handover — the rails behind the
 * HUMAN_THERAPIST recommendation (docs/CARE_GROWTH_SYSTEM.md §5). "Here's
 * how to find a therapist" with no artefact is a recommendation designed
 * to fail; this produces the compact, clinician-facing summary the user
 * hands to their new therapist: the plan, the instrument series, the
 * reliable-change verdicts, and the session cadence — NO transcripts
 * (those stay the user's; the full export is theirs in Settings).
 * Audited under the existing CARE_DATA_EXPORTED action.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireCareUserId(req);
  if (!auth.ok) return auth.response;
  const { careUser, careUserId } = auth.value;

  const [caseFile, instruments, sessions] = await Promise.all([
    getCareCaseFile(careUserId),
    prisma.careInstrumentResponse.findMany({
      where: { careUserId },
      orderBy: { createdAt: 'asc' },
      select: { instrumentKey: true, totalScore: true, createdAt: true },
    }),
    prisma.careSession.findMany({
      where: { careUserId, status: 'COMPLETED' },
      orderBy: { createdAt: 'asc' },
      select: { kind: true, createdAt: true, durationSec: true },
    }),
  ]);

  const handover = {
    preparedAt: new Date().toISOString(),
    preparedBy:
      'Cureocity Care — an AI-therapist support product. This summary is for continuity of care; it is not a clinical diagnosis.',
    client: { firstName: careUser.displayName.split(' ')[0] },
    workingPlan: caseFile.plan
      ? {
          version: caseFile.plan.version,
          formulation: caseFile.plan.formulation,
          goals: caseFile.plan.goals,
          modalityTrack: caseFile.plan.modalityTrack,
          cadence: caseFile.plan.cadence,
        }
      : null,
    sessions: {
      completed: sessions.length,
      byKind: sessions.reduce<Record<string, number>>((acc, s) => {
        acc[s.kind] = (acc[s.kind] ?? 0) + 1;
        return acc;
      }, {}),
      firstAt: sessions[0]?.createdAt ?? null,
      lastAt: sessions[sessions.length - 1]?.createdAt ?? null,
    },
    instrumentSeries: instruments,
    reliableChangeVerdicts: caseFile.verdicts,
    lastSessionSummary: caseFile.lastReportSummary ?? null,
  };

  await writeAudit({
    actorType: 'CLIENT',
    action: 'CARE_DATA_EXPORTED',
    targetType: 'CareUser',
    targetId: careUserId,
    metadata: { ...auditMetadataFromRequest(req), variant: 'handover' },
  });

  return new NextResponse(JSON.stringify(handover, null, 2), {
    headers: {
      'content-type': 'application/json',
      'content-disposition': 'attachment; filename="care-handover-summary.json"',
    },
  });
}
