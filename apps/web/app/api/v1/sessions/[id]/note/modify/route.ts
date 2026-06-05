import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { GoogleGenAI, HarmBlockThreshold, HarmCategory } from '@google/genai';
import { TherapyNoteV1Schema, type TherapyNoteV1 } from '@cureocity/contracts';
import { ensureGcpCreds } from '@/lib/llm';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const ModifyInputSchema = z.object({
  instruction: z.string().min(3).max(1000),
});

const SYSTEM_PROMPT = `You edit therapy notes in the TherapyNoteV1 schema.

Input: the current TherapyNoteV1 JSON and an instruction from the therapist.
Task: apply the instruction to the note and output the FULL modified
TherapyNoteV1 JSON. Preserve structure. Only change what the instruction
requires — do not invent new content beyond what was in the original
note, do not add facts that were not present.

Constraints:
- Output STRICT JSON matching TherapyNoteV1 — same field names + types.
- Preserve riskFlags severity unless the instruction explicitly asks
  to re-assess (downgrading risk silently is dangerous).
- Preserve modality field.
- No prose, no markdown, no commentary.`;

/**
 * POST /api/v1/sessions/[id]/note/modify — therapist sends a free-text
 * instruction ("make it more concise", "rewrite plan as bullets",
 * "remove all client names"); LLM rewrites the draft note accordingly.
 *
 * Only available pre-sign (against NoteDraft). After sign-off, edits go
 * through POST /note/edit, which audits as a revision (different
 * compliance posture — signed notes get an immutable diff trail).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await params;
  const body = await parseJson(req, ModifyInputSchema);
  if (!body.ok) return body.response;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      psychologistId: true,
      noteDraft: { select: { id: true, content: true, status: true } },
      therapyNote: { select: { id: true } },
    },
  });
  if (!session || session.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  if (session.therapyNote) {
    return NextResponse.json(
      { error: 'Note is signed. Use POST /note/edit to record a revision instead.' },
      { status: 409 },
    );
  }
  if (!session.noteDraft || !session.noteDraft.content) {
    return NextResponse.json(
      { error: 'No draft to modify yet — generate the note first.' },
      { status: 404 },
    );
  }
  if (session.noteDraft.status !== 'COMPLETED') {
    return NextResponse.json(
      { error: `Draft is in ${session.noteDraft.status} state. Wait for generation to complete.` },
      { status: 409 },
    );
  }

  const currentNote = TherapyNoteV1Schema.parse(session.noteDraft.content);

  const llmBackend = process.env['LLM_BACKEND'] ?? 'mock';
  if (llmBackend !== 'vertex') {
    return NextResponse.json(
      {
        error:
          'Modify is Vertex-only (mock backend has no editing capability). Set LLM_BACKEND=vertex.',
      },
      { status: 501 },
    );
  }

  ensureGcpCreds();
  const project = process.env['VERTEX_PROJECT_ID'];
  if (!project) {
    return NextResponse.json({ error: 'VERTEX_PROJECT_ID not set' }, { status: 500 });
  }
  const proRegion = process.env['VERTEX_PRO_REGION'] ?? 'global';
  const proModel = process.env['VERTEX_PRO_MODEL'] ?? 'gemini-2.5-pro';
  const ai = new GoogleGenAI({ vertexai: true, project, location: proRegion });

  const userMessage = [
    'Current TherapyNoteV1:',
    JSON.stringify(currentNote, null, 2),
    '',
    'Instruction:',
    body.value.instruction,
    '',
    'Output the modified TherapyNoteV1 JSON only.',
  ].join('\n');

  const res = await ai.models.generateContent({
    model: proModel,
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: 'application/json',
      temperature: 0.2,
      maxOutputTokens: 8192,
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.OFF },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.OFF },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.OFF },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.OFF },
      ],
    },
  });

  const text = res.text ?? '{}';
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return NextResponse.json(
      { error: 'Model returned non-JSON', preview: text.slice(0, 200) },
      { status: 502 },
    );
  }
  // Defensive: force-restore modality + riskFlags.severity so the
  // model can't silently corrupt those if it ignored the system prompt.
  const candidate = parsed as Partial<TherapyNoteV1>;
  const merged: TherapyNoteV1 = {
    ...currentNote,
    ...candidate,
    modality: currentNote.modality,
    riskFlags: {
      ...currentNote.riskFlags,
      ...(candidate.riskFlags ?? {}),
      severity: currentNote.riskFlags.severity,
    },
  };
  const validated = TherapyNoteV1Schema.parse(merged);

  // Persist + figure out which top-level fields actually changed for
  // the response payload (the client uses this to highlight the diff).
  const changedFields: string[] = [];
  for (const k of ['subjective', 'objective', 'assessment', 'plan'] as const) {
    if (currentNote[k] !== validated[k]) changedFields.push(k);
  }

  await prisma.$transaction(async (tx) => {
    await tx.noteDraft.update({
      where: { id: session.noteDraft!.id },
      data: { content: validated as unknown as object },
    });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'NOTE_DRAFT_VIEWED',
        targetType: 'NoteDraft',
        targetId: session.noteDraft!.id,
        metadata: {
          ...auditMetadataFromRequest(req),
          op: 'modify',
          instruction: body.value.instruction,
          changedFields,
        },
      },
      tx,
    );
  });

  return NextResponse.json({
    note: validated,
    changedFields,
    model: proModel,
  });
}
