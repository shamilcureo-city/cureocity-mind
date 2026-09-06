import { NextResponse, type NextRequest } from 'next/server';
import { TherapyScriptV1Schema } from '@cureocity/contracts';
import { requireCapability, requirePsychologistId } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';
import { writeAudit } from '@/lib/audit';
import { ClientPhiWriteForbiddenError, lockActiveClient } from '@/lib/phi-write-lock';
import { MindGuideReviewUpdateSchema, readGuideReview } from '@/lib/mind-guide-review';
import { mindGuideSteps } from '@/lib/mind-guidance';
import { parseJson } from '@/lib/validate';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string; scriptId: string }> };
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });

async function handle(req: NextRequest, context: Context, write: boolean) {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  if (auth.value.user.vertical !== 'THERAPIST') return json({ error: 'Not found' }, 404);
  const capability = await requireCapability(req, 'THERAPY_WORKFLOWS', auth);
  if (!capability.ok) return capability.response;
  const { id: clientId, scriptId } = await context.params;
  const payload = write ? await parseJson(req, MindGuideReviewUpdateSchema) : null;
  if (payload && !payload.ok) return payload.response;
  const owner = { id: scriptId, clientId, psychologistId: auth.value.psychologistId };
  try {
    return await prisma.$transaction(async (tx) => {
      // Serialize with guide regeneration and erasure; recheck ownership under lock.
      await lockActiveClient(tx, clientId, auth.value.psychologistId);
      const row = await tx.therapyScript.findFirst({
        where: owner,
        select: { body: true, updatedAt: true, reviewProgress: true },
      });
      if (!row) return json({ error: 'Guide not found' }, 404);
      const script = TherapyScriptV1Schema.safeParse(row.body);
      if (!script.success) return json({ error: 'This guide needs to be prepared again.' }, 409);
      const scriptUpdatedAt = row.updatedAt.toISOString();
      const stepCount = mindGuideSteps(script.data).length;
      const saved = readGuideReview(row.reviewProgress, scriptUpdatedAt, stepCount);
      const revision = saved?.revision ?? 0;
      if (!write) return json({ progress: saved, revision, scriptUpdatedAt });
      if (!payload?.ok) return json({ error: 'Invalid review progress' }, 400);
      const { expectedRevision, ...snapshot } = payload.value;
      const progress = readGuideReview(
        { ...snapshot, revision: revision + 1 },
        scriptUpdatedAt,
        stepCount,
      );
      if (!progress)
        return json(
          {
            code: 'GUIDE_CHANGED',
            error: 'This guide changed. Reopen it before saving review progress.',
          },
          409,
        );
      if (expectedRevision !== revision)
        return json(
          {
            code: 'GUIDE_REVIEW_CONFLICT',
            error:
              'Saved progress changed in another view. Reload saved progress before continuing.',
          },
          409,
        );
      const updated = await tx.therapyScript.updateMany({
        where: { ...owner, updatedAt: row.updatedAt },
        // updatedAt identifies the clinical draft, not its UI cursor. Preserve it
        // so saving review markers cannot invalidate the content being reviewed.
        data: { reviewProgress: progress, updatedAt: row.updatedAt },
      });
      if (updated.count !== 1)
        return json({ error: 'This guide changed. Reopen it before continuing.' }, 409);
      await writeAudit(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: auth.value.psychologistId,
          action: 'THERAPY_GUIDE_REVIEW_UPDATED',
          targetType: 'TherapyScript',
          targetId: scriptId,
          metadata: {
            clientId,
            scriptUpdatedAt,
            activeIndex: progress.activeIndex,
            reviewedIndexes: progress.reviewedIndexes,
          },
        },
        tx,
      );
      return json({ progress });
    });
  } catch (error) {
    if (error instanceof ClientPhiWriteForbiddenError)
      return json({ error: 'Client not found' }, 404);
    throw error;
  }
}

export async function GET(req: NextRequest, context: Context) {
  return handle(req, context, false);
}
export async function PATCH(req: NextRequest, context: Context) {
  return handle(req, context, true);
}
