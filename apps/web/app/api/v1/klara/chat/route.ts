import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { GoogleGenAI, HarmBlockThreshold, HarmCategory } from '@google/genai';
import { ensureGcpCreds } from '@/lib/llm';
import { requirePsychologistId } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(8000),
});

const ChatInputSchema = z.object({
  messages: z.array(MessageSchema).min(1).max(20),
});

const SYSTEM_PROMPT = `You are Klara, a private AI assistant for an Indian psychotherapy practice.

You help the therapist think about their caseload, prepare for sessions, and reflect
on their work. You are NOT a therapist; you do not diagnose. You synthesise from the
therapist's own clinical records that are provided as context.

When answering:
- Be concise. Default to 2-4 sentences unless the therapist asks for more detail.
- Always reference specific clients by name when the data warrants — the therapist
  is the only reader, no de-identification needed.
- When you don't have data to answer, say so plainly. Do not invent.
- Use plain prose, not markdown headings or bullets, unless asked for a structured
  list.
- Maintain professional, warm-but-not-effusive tone.
- Never recommend medications or specific clinical interventions; recommend the
  therapist consider X instead.

If asked something outside the practice context (general news, coding, etc.),
politely redirect: "I can only help with your therapeutic practice."`;

/**
 * POST /api/v1/klara/chat — context-aware chat with the therapist's
 * data. The server builds a short snapshot of the therapist's
 * roster (recent sessions, active workflows, client list) and
 * prepends it to the system prompt so the model can ground answers
 * in the actual data without needing retrieval/tool-calling.
 *
 * Limits: 20 messages of history, 8 KB per message, 30 s function
 * budget. Cost-wise this is a Vertex Pro call — therapist pays per
 * conversation turn.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const body = await parseJson(req, ChatInputSchema);
  if (!body.ok) return body.response;

  const llmBackend = process.env['LLM_BACKEND'] ?? 'mock';
  if (llmBackend !== 'vertex') {
    return NextResponse.json({
      reply:
        "I'm running in mock mode — set LLM_BACKEND=vertex in your Vercel env to enable real chat responses.",
      model: 'mock',
    });
  }

  const context = await buildContext(auth.value.psychologistId);

  ensureGcpCreds();
  const project = process.env['VERTEX_PROJECT_ID'];
  if (!project) {
    return NextResponse.json({ error: 'VERTEX_PROJECT_ID not set' }, { status: 500 });
  }
  const proRegion = process.env['VERTEX_PRO_REGION'] ?? 'global';
  const proModel = process.env['VERTEX_PRO_MODEL'] ?? 'gemini-2.5-pro';
  const ai = new GoogleGenAI({ vertexai: true, project, location: proRegion });

  const systemInstruction = `${SYSTEM_PROMPT}\n\n## Current practice snapshot\n\n${context}`;

  // Map the chat history into the SDK's Content[] shape. Assistant
  // turns map to role: 'model' (the Gemini convention).
  const contents = body.value.messages.map((m) => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.content }],
  }));

  const res = await ai.models.generateContent({
    model: proModel,
    contents,
    config: {
      systemInstruction,
      temperature: 0.4,
      maxOutputTokens: 1024,
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.OFF },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.OFF },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.OFF },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.OFF },
      ],
    },
  });

  const reply = res.text?.trim() ?? '';
  if (!reply) {
    return NextResponse.json({
      reply: "I didn't have anything to say there — try rephrasing the question.",
      model: proModel,
    });
  }

  return NextResponse.json({ reply, model: proModel });
}

/**
 * Build a compact text snapshot of the therapist's practice for the
 * system prompt. Held to ~2 KB so it fits comfortably alongside the
 * rolling chat history.
 */
async function buildContext(psychologistId: string): Promise<string> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [clients, recentSessions, workflows, upcomingSessions] = await Promise.all([
    prisma.client.findMany({
      where: { psychologistId, deletedAt: null },
      select: {
        id: true,
        fullName: true,
        preferredModality: true,
        sessions: {
          orderBy: { scheduledAt: 'desc' },
          take: 1,
          select: { scheduledAt: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 30,
    }),
    prisma.session.findMany({
      where: {
        psychologistId,
        status: 'COMPLETED',
        endedAt: { gte: thirtyDaysAgo },
      },
      include: {
        client: { select: { fullName: true } },
        therapyNote: { select: { content: true } },
      },
      orderBy: { endedAt: 'desc' },
      take: 10,
    }),
    prisma.modalityState.findMany({
      where: { psychologistId, completedAt: null },
      include: { client: { select: { fullName: true } } },
      take: 30,
    }),
    prisma.session.findMany({
      where: {
        psychologistId,
        status: 'SCHEDULED',
        scheduledAt: { gte: new Date(), lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
      },
      include: { client: { select: { fullName: true } } },
      orderBy: { scheduledAt: 'asc' },
      take: 10,
    }),
  ]);

  const lines: string[] = [];

  lines.push(`Active clients on roster: ${clients.length}`);
  const inactive = clients.filter(
    (c) => !c.sessions[0] || c.sessions[0].scheduledAt < thirtyDaysAgo,
  );
  if (inactive.length > 0) {
    lines.push(
      `Clients not seen in 30+ days: ${inactive
        .map((c) => c.fullName)
        .slice(0, 10)
        .join(', ')}${inactive.length > 10 ? ` +${inactive.length - 10} more` : ''}`,
    );
  }

  lines.push('');
  lines.push(`Upcoming sessions (next 7 days): ${upcomingSessions.length}`);
  for (const s of upcomingSessions.slice(0, 6)) {
    lines.push(
      `  - ${s.client.fullName} (${s.modality}) on ${s.scheduledAt.toISOString().slice(0, 16).replace('T', ' ')}`,
    );
  }

  lines.push('');
  lines.push(`Sessions completed in last 7 days: ${recentSessions.filter((s) => s.endedAt && s.endedAt >= sevenDaysAgo).length}`);
  lines.push(`Sessions completed in last 30 days: ${recentSessions.length}`);
  for (const s of recentSessions.slice(0, 5)) {
    const note = s.therapyNote?.content as
      | { riskFlags?: { severity?: string }; assessment?: string }
      | null
      | undefined;
    const severity = note?.riskFlags?.severity ?? 'unknown';
    const summary = note?.assessment?.split('.')[0]?.slice(0, 120) ?? '(no signed note)';
    lines.push(
      `  - ${s.client.fullName} (${s.modality}, ${s.endedAt?.toISOString().slice(0, 10)}, risk: ${severity}): ${summary}`,
    );
  }

  if (workflows.length > 0) {
    lines.push('');
    lines.push('Active workflows:');
    for (const w of workflows.slice(0, 10)) {
      lines.push(`  - ${w.client.fullName}: ${w.modality} in ${w.currentPhase}`);
    }
  }

  const highRisk = recentSessions.filter((s) => {
    const note = s.therapyNote?.content as { riskFlags?: { severity?: string } } | null | undefined;
    return note?.riskFlags?.severity === 'high' || note?.riskFlags?.severity === 'critical';
  });
  if (highRisk.length > 0) {
    lines.push('');
    lines.push(
      `High-risk recent sessions: ${highRisk.map((s) => s.client.fullName).join(', ')}`,
    );
  }

  return lines.join('\n');
}
