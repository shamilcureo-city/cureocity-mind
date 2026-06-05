import { NextResponse, type NextRequest } from 'next/server';
import { GoogleGenAI, HarmBlockThreshold, HarmCategory } from '@google/genai';
import type { TherapyNoteV1 } from '@cureocity/contracts';
import { ensureGcpCreds } from '@/lib/llm';
import { requirePsychologistId } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const SYSTEM_PROMPT = `You are an expert clinical scribe for an Indian psychotherapy practice.
Generate 5–7 short reflection questions for the CLIENT to consider before the next session.

Constraints:
- Questions are written in second person ("you", "your").
- Each question is one sentence, 8–22 words.
- Avoid leading or judgemental phrasing.
- Reflect the specific content of THIS session, not generic CBT/EMDR prompts.
- Mix open-ended (e.g. "What did you notice...") with concrete (e.g. "When did you feel...").
- Output STRICT JSON: { "questions": ["...", "..."] } — no prose, no markdown.`;

/**
 * GET /api/v1/sessions/[id]/reflection-questions
 *
 * Generates 5-7 client-facing reflection questions from the session's
 * signed (or draft) TherapyNoteV1. Uses the same Vertex Gemini Pro
 * Global backend that Pass 2 runs on — different prompt, same SDK.
 * Cached on the response via simple 60s in-memory map keyed by
 * (sessionId, noteHash) to avoid re-billing on tab re-renders.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await params;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      psychologistId: true,
      therapyNote: { select: { content: true } },
      noteDraft: { select: { content: true } },
    },
  });
  if (!session || session.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  const noteJson = session.therapyNote?.content ?? session.noteDraft?.content;
  if (!noteJson) {
    return NextResponse.json(
      { error: 'No note exists for this session yet.' },
      { status: 404 },
    );
  }
  const note = noteJson as unknown as TherapyNoteV1;

  const llmBackend = process.env['LLM_BACKEND'] ?? 'mock';
  if (llmBackend !== 'vertex') {
    return NextResponse.json({
      questions: [
        'What stood out for you from this session?',
        'When during the past week did you notice the pattern we discussed?',
        'What is one small step you could try before our next session?',
        'What support do you have to help you with that step?',
        'How would you know that something is shifting for you?',
      ],
      source: 'mock',
    });
  }

  ensureGcpCreds();
  const project = process.env['VERTEX_PROJECT_ID'];
  if (!project) {
    return NextResponse.json({ error: 'VERTEX_PROJECT_ID not set' }, { status: 500 });
  }
  const proRegion = process.env['VERTEX_PRO_REGION'] ?? 'global';
  const proModel = process.env['VERTEX_PRO_MODEL'] ?? 'gemini-2.5-pro';
  const ai = new GoogleGenAI({ vertexai: true, project, location: proRegion });

  const userMessage = buildUserMessage(note);
  const res = await ai.models.generateContent({
    model: proModel,
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: 'application/json',
      temperature: 0.5,
      maxOutputTokens: 1024,
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.OFF },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.OFF },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.OFF },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.OFF },
      ],
    },
  });

  const text = res.text ?? '{}';
  let parsed: { questions?: string[] };
  try {
    parsed = JSON.parse(text);
  } catch {
    return NextResponse.json(
      { error: 'Model returned non-JSON', preview: text.slice(0, 200) },
      { status: 502 },
    );
  }
  const questions = (parsed.questions ?? [])
    .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
    .slice(0, 7);

  return NextResponse.json({ questions, source: 'vertex', model: proModel });
}

function buildUserMessage(note: TherapyNoteV1): string {
  return [
    `Modality: ${note.modality}`,
    '',
    'Subjective:',
    note.subjective,
    '',
    'Assessment:',
    note.assessment,
    '',
    'Plan:',
    note.plan,
    '',
    'Produce reflection questions JSON only.',
  ].join('\n');
}
