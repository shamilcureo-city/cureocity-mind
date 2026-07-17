import { NextResponse, type NextRequest } from 'next/server';
import {
  PlanDictationRequestSchema,
  RxPadDraftSchema,
  type PlanDictationProposal,
  type RxPadDraft,
} from '@cureocity/contracts';
import { proposePlanEdits } from '@cureocity/clinical';
import type { ClinicalLocale } from '@cureocity/llm';
import { requirePsychologistId } from '@/lib/auth-server';
import { CostCircuitOpenError } from '@/lib/cost-guard';
import { modelRouter } from '@/lib/llm';
import { runPlanDictation } from '@/lib/plan-dictation';
import { parseJson } from '@/lib/validate';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Raw 16 kHz s16le PCM — 90 s is the schema ceiling, ~2.9 MB decoded. */
const MAX_AUDIO_BYTES = 3 * 1024 * 1024;

/**
 * Sprint DS12 — voice-edit the plan.
 *
 * POST /api/v1/sessions/:id/plan-dictation
 *   { text } or { audioBase64, durationMs }
 *   → { transcript, changes[], clarifications[], skipped[] }
 *
 * PROPOSAL-ONLY: nothing here writes to the pad. The doctor's spoken
 * instruction is transcribed (medical Pass 1) if it arrived as audio, turned
 * into typed edit commands (the plan-dictation pass), and resolved against
 * the CURRENT draft pad into reviewable RxPadPatchOps with an interaction
 * preview. Applying is the client's explicit tap through the existing
 * audited PATCH /rx-pad — which recomputes authoritative warnings.
 *
 * Doctor-vertical only; the pad must exist (a note draft) and must not be
 * signed. POST-only: the route has an LLM cost side effect and must never
 * be reachable by a prefetching GET.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await params;
  const parsed = await parseJson(req, PlanDictationRequestSchema);
  if (!parsed.ok) return parsed.response;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      psychologistId: true,
      language: true,
      psychologist: { select: { vertical: true } },
      noteDraft: { select: { id: true, rxPad: true } },
      therapyNote: { select: { signedAt: true } },
      client: { select: { spokenLanguages: true } },
    },
  });
  if (!session || session.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  if (session.psychologist.vertical !== 'DOCTOR') {
    return NextResponse.json(
      { error: 'Plan dictation is for the doctor vertical only.' },
      { status: 409 },
    );
  }
  if (session.therapyNote?.signedAt != null) {
    return NextResponse.json(
      { error: 'This note is signed — the plan can no longer be edited.' },
      { status: 409 },
    );
  }
  if (!session.noteDraft) {
    return NextResponse.json(
      { error: 'No encounter note yet — record or generate the note first.' },
      { status: 409 },
    );
  }

  // What was said — typed text passes straight through; audio goes through
  // the medical Pass-1 ASR (drug names + dosing shorthand, asia-south1).
  let transcript: string;
  if (parsed.value.text !== undefined) {
    transcript = parsed.value.text;
  } else {
    const audioBytes = Buffer.from(parsed.value.audioBase64 ?? '', 'base64');
    if (audioBytes.length === 0 || audioBytes.length > MAX_AUDIO_BYTES) {
      return NextResponse.json(
        { error: 'The audio clip is empty or too long — keep it under 90 seconds.' },
        { status: 413 },
      );
    }
    // s16le @ 16 kHz → 32 bytes/ms. Derived from the bytes, not trusted
    // from the client (it only feeds cost estimation).
    const durationMs = Math.max(1, Math.round(audioBytes.length / 32));
    try {
      const hints =
        session.client && session.client.spokenLanguages.length > 0
          ? { spokenLanguageHints: session.client.spokenLanguages }
          : undefined;
      const pass1 = await modelRouter().pass1({
        sessionId,
        audioBytes,
        durationMs,
        vertical: 'DOCTOR',
        ...(hints && { hints }),
      });
      if (pass1.callLog.status !== 'SUCCESS') {
        return NextResponse.json(
          { error: 'Could not transcribe the instruction — please try again.' },
          { status: 502 },
        );
      }
      transcript = pass1.output.transcript;
    } catch {
      return NextResponse.json(
        { error: 'Could not transcribe the instruction — please try again.' },
        { status: 502 },
      );
    }
  }

  const pad = parsePad(session.noteDraft.rxPad);
  const emptyProposal = (clarification: string): PlanDictationProposal => ({
    transcript,
    changes: [],
    clarifications: [clarification],
    skipped: [],
  });
  if (transcript.trim().length < 3) {
    return NextResponse.json(emptyProposal('Could not hear an instruction — please try again.'));
  }

  try {
    const dictation = await runPlanDictation({
      sessionId,
      psychologistId: auth.value.psychologistId,
      command: transcript,
      rxPad: pad ?? { version: 'V1' },
      language: (session.language as ClinicalLocale | null) ?? 'en',
    });
    const proposal = proposePlanEdits(pad, dictation);
    const body: PlanDictationProposal = { transcript, ...proposal };
    return NextResponse.json(body);
  } catch (e) {
    if (e instanceof CostCircuitOpenError) {
      return NextResponse.json(
        { error: 'The AI budget for this session is used up — edit the plan by hand.' },
        { status: 429 },
      );
    }
    console.error(`[plan-dictation] sessionId=${sessionId} failed: ${(e as Error).message}`);
    return NextResponse.json(
      { error: 'Could not interpret the instruction — please try again.' },
      { status: 502 },
    );
  }
}

/** Defensive parse — bad stored JSON degrades to null, never a 500. */
function parsePad(value: unknown): RxPadDraft | null {
  if (value == null) return null;
  const parsed = RxPadDraftSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
