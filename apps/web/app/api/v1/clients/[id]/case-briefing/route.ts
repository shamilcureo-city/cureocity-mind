import { NextResponse, type NextRequest } from 'next/server';
import { CaseBriefingV1Schema, type CaseBriefingV1 } from '@cureocity/contracts';
import { recordGeminiCall } from '@cureocity/observability/metrics';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { buildDeterministicCaseBriefing, gatherInputs } from '@/lib/case-briefing';
import { JourneyError } from '@/lib/journey';
import { modelRouter } from '@/lib/llm';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET  /api/v1/clients/[id]/case-briefing — fast deterministic briefing.
 * POST /api/v1/clients/[id]/case-briefing — run Pass 6 (LLM-refined),
 *      falling back to the deterministic briefing if the model fails.
 *
 * Sprint 22 — the synthesis at the centre of the Case Workspace. GET is
 * used for the server-rendered first paint; POST is the "refresh" that
 * produces the richer LLM narrative.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: clientId } = await params;
  try {
    const briefing = await buildDeterministicCaseBriefing(clientId, auth.value.psychologistId);
    return NextResponse.json({ briefing });
  } catch (e) {
    if (e instanceof JourneyError) {
      return NextResponse.json({ error: e.message }, { status: 404 });
    }
    throw e;
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: clientId } = await params;

  let inputs;
  try {
    inputs = await gatherInputs(clientId, auth.value.psychologistId);
  } catch (e) {
    if (e instanceof JourneyError) {
      return NextResponse.json({ error: e.message }, { status: 404 });
    }
    throw e;
  }

  // The deterministic briefing is both the fast path and the LLM fallback.
  const { composeBriefing } = await import('@/lib/case-briefing');
  const deterministic = composeBriefing(inputs);

  let briefing: CaseBriefingV1 = deterministic;
  try {
    const router = modelRouter();
    const result = await router.pass6({
      clientId,
      // Case briefings are therapist-facing; the therapist UI is
      // English-only in V1 (same as notes/brief defaults). ICD labels
      // stay English regardless.
      language: 'en',
      contextText: serialiseContext(inputs),
      deterministicBriefingJson: JSON.stringify(deterministic),
    });
    const parsed = CaseBriefingV1Schema.safeParse(result.output.caseBriefing);
    if (parsed.success) {
      briefing = { ...parsed.data, source: 'llm' };
    }
    recordGeminiCall({
      pass: result.callLog.pass,
      status: result.callLog.status,
      region: result.callLog.region,
      durationMs: result.callLog.latencyMs,
    });
    await prisma.geminiCallLog.create({
      data: {
        sessionId: null,
        pass: result.callLog.pass,
        model: result.callLog.model,
        region: result.callLog.region,
        promptVersion: result.callLog.promptVersion,
        inputTokens: result.callLog.inputTokens,
        outputTokens: result.callLog.outputTokens,
        costInr: result.callLog.costInr,
        latencyMs: result.callLog.latencyMs,
        status: result.callLog.status,
      },
    });
  } catch (e) {
    // Non-fatal — keep the deterministic briefing.
    console.error(`[case-briefing] Pass 6 failed for client ${clientId}: ${(e as Error).message}`);
  }

  await writeAudit({
    actorType: 'PSYCHOLOGIST',
    actorPsychologistId: auth.value.psychologistId,
    action: 'CASE_BRIEFING_GENERATED',
    targetType: 'Client',
    targetId: clientId,
    metadata: {
      ...auditMetadataFromRequest(req),
      clientId,
      source: briefing.source,
      openItemCount: briefing.openItems.length,
      nextActionCount: briefing.nextActions.length,
    },
  });

  return NextResponse.json({ briefing });
}

/** Compact text dump of the cumulative record for the Pass 6 prompt. */
function serialiseContext(inputs: Awaited<ReturnType<typeof gatherInputs>>): string {
  const j = inputs.journey;
  const lines: string[] = [];
  lines.push(`Stage: ${j.stage}`);
  lines.push(`Completed sessions: ${j.sessionsCompleted}`);
  if (j.workingDiagnosis) {
    lines.push(
      `Confirmed diagnosis: ${j.workingDiagnosis.icd11Code} ${j.workingDiagnosis.icd11Label} (confidence ${j.workingDiagnosis.confidence})`,
    );
  }
  if (j.activePlan) {
    lines.push(
      `Active plan v${j.activePlan.version} (${j.activePlan.modality ?? 'modality TBD'}); goals ${j.activePlan.goalsAchieved}/${j.activePlan.goalsTotal} achieved:`,
    );
    for (const g of j.activePlan.goals) lines.push(`  - [${g.status}] ${g.description}`);
  }
  if (j.instrumentChanges.length > 0) {
    lines.push('Instruments:');
    for (const c of j.instrumentChanges) {
      lines.push(
        `  - ${c.instrumentKey}: ${c.baselineScore} → ${c.latestScore} (${c.verdict}${c.isRemission ? ', remission' : ''})`,
      );
    }
  }
  if (inputs.presentingConcerns) lines.push(`Presenting concerns: ${inputs.presentingConcerns}`);
  if (inputs.intakeNote) {
    lines.push(
      `Intake — history of presenting illness: ${inputs.intakeNote.historyOfPresentingIllness}`,
    );
    lines.push(`Intake — working hypothesis: ${inputs.intakeNote.workingHypothesis}`);
    lines.push(`Intake — social history: ${inputs.intakeNote.socialHistory}`);
    lines.push(`Intake — family history: ${inputs.intakeNote.familyHistory}`);
  }
  if (inputs.openItems.length > 0) {
    lines.push('Open assessment items (the running differential):');
    for (const i of inputs.openItems) lines.push(`  - (${i.kind}) ${i.question} — ${i.rationale}`);
  }
  lines.push(`Safety plan on file: ${inputs.hasSafetyPlan ? 'yes' : 'no'}`);
  return lines.join('\n');
}
