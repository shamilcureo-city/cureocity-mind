import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { GoogleGenAI, HarmBlockThreshold, HarmCategory } from '@google/genai';
import { ensureGcpCreds } from '@/lib/llm';
import { requirePsychologistId } from '@/lib/auth-server';
import { decryptClientField } from '@/lib/client-pii';
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
  /// Sprint 22 — when present, the assistant loads that client's
  /// cumulative record and answers as a case-specific reasoning partner.
  clientId: z.string().optional(),
});

const SYSTEM_PROMPT = `You are a private AI practice assistant for an Indian psychotherapy practice.

You help the therapist think about their caseload, prepare for sessions, and reflect
on their work. You are NOT a therapist; you do not diagnose. You synthesise from the
therapist's own clinical records that are provided as context.

When answering:
- Be concise. Default to 2-4 sentences unless the therapist asks for more detail.
- Reference specific clients when the data warrants. Client names in your context
  are shortened to "FirstName S." for data minimisation — use them in that form;
  the therapist knows who is who.
- When you don't have data to answer, say so plainly. Do not invent.
- Use plain prose, not markdown headings or bullets, unless asked for a structured
  list.
- Maintain professional, warm-but-not-effusive tone.
- Never recommend medications or specific clinical interventions; recommend the
  therapist consider X instead.

If asked something outside the practice context (general news, coding, etc.),
politely redirect: "I can only help with your therapeutic practice."`;

/**
 * POST /api/v1/practice-assistant/chat — context-aware chat with the
 * therapist's data. The server builds a short snapshot of the
 * therapist's roster (recent sessions, active workflows, client list)
 * and prepends it to the system prompt so the model can ground answers
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

  // Sprint 22 — client-scoped chat ("Ask about <client>") loads that
  // one client's record; otherwise the practice-wide roster snapshot.
  const context = body.value.clientId
    ? await buildClientContext(auth.value.psychologistId, body.value.clientId)
    : await buildContext(auth.value.psychologistId);

  ensureGcpCreds();
  const project = process.env['VERTEX_PROJECT_ID'];
  if (!project) {
    return NextResponse.json({ error: 'VERTEX_PROJECT_ID not set' }, { status: 500 });
  }
  const proRegion = process.env['VERTEX_PRO_REGION'] ?? 'global';
  const proModel = process.env['VERTEX_PRO_MODEL'] ?? 'gemini-2.5-pro';
  const ai = new GoogleGenAI({ vertexai: true, project, location: proRegion });

  const heading = body.value.clientId ? 'Current client' : 'Current practice snapshot';
  const systemInstruction = `${SYSTEM_PROMPT}\n\n## ${heading}\n\n${context}`;

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
        {
          category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: HarmBlockThreshold.OFF,
        },
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: HarmBlockThreshold.OFF,
        },
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
 * Data minimisation for the cross-border LLM call: client names are
 * reduced to "FirstName S." before entering the system prompt. The
 * chat stays usable ("how is Asha doing?") while full legal names
 * stay out of the global-region Gemini context. Transcripts and full
 * note bodies are never included — only the briefing synthesis and
 * one-line assessment summaries.
 */
function redactName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 1) return parts[0] ?? 'Client';
  return `${parts[0]} ${parts[parts.length - 1]![0]}.`;
}

/**
 * Sprint 22 — compact cumulative record for ONE client. Reuses the
 * deterministic case-briefing builder so the chat is grounded in the
 * same synthesis the workspace shows. Cross-tenant access throws inside
 * the builder, which we surface as a short refusal.
 */
async function buildClientContext(psychologistId: string, clientId: string): Promise<string> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: {
      fullName: true,
      fullNameEncrypted: true,
      psychologistId: true,
      presentingConcerns: true,
    },
  });
  if (!client || client.psychologistId !== psychologistId) {
    return 'No accessible client record. Tell the therapist you cannot find that client.';
  }
  const fullName = await decryptClientField(
    client.psychologistId,
    client.fullNameEncrypted,
    client.fullName,
  );
  try {
    const { buildDeterministicCaseBriefing } = await import('@/lib/case-briefing');
    const briefing = await buildDeterministicCaseBriefing(clientId, psychologistId);
    const lines = [
      `Client: ${redactName(fullName)}`,
      `Presenting concerns: ${client.presentingConcerns ?? '(not recorded)'}`,
      `Headline: ${briefing.headline}`,
      `Working diagnosis: ${
        briefing.workingDiagnosis
          ? `${briefing.workingDiagnosis.icd11Code} ${briefing.workingDiagnosis.icd11Label} (${
              briefing.workingDiagnosis.confirmed ? 'confirmed' : 'working'
            })`
          : '(none yet)'
      }`,
      'Formulation (5 Ps):',
      `  Presenting: ${briefing.formulation.presenting}`,
      `  Predisposing: ${briefing.formulation.predisposing}`,
      `  Precipitating: ${briefing.formulation.precipitating}`,
      `  Perpetuating: ${briefing.formulation.perpetuating}`,
      `  Protective: ${briefing.formulation.protective}`,
      'Open assessment items:',
      ...briefing.openItems.map((i) => `  - ${i.question} (${i.rationale})`),
      'Suggested next actions:',
      ...briefing.nextActions.map((a) => `  - ${a.title}: ${a.detail} [why: ${a.why}]`),
      `Recommended next session interval: ~${briefing.cadence.recommendedIntervalDays} days (${briefing.cadence.rationale})`,
      `Safety: severity ${briefing.safety.highestSeverity}; safety plan on file: ${briefing.safety.hasSafetyPlan ? 'yes' : 'no'}`,
    ];
    return lines.join('\n');
  } catch {
    return `Client: ${redactName(client.fullName)}. (Could not assemble the full record — answer from general principles and say so.)`;
  }
}

/**
 * Build a compact text snapshot of the therapist's practice for the
 * system prompt. Held to ~2 KB so it fits comfortably alongside the
 * rolling chat history.
 */
async function buildContext(psychologistId: string): Promise<string> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // Sprint 48 — the practice-wide assistant context must not ground
  // answers in the seeded demo client. (Client-scoped chat on the demo
  // client itself stays allowed; that path enters via
  // /practice-assistant/chat with a clientId and never visits this builder.)
  const [clients, recentSessions, workflows, upcomingSessions] = await Promise.all([
    prisma.client.findMany({
      where: { psychologistId, deletedAt: null, isDemo: false },
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
        client: { isDemo: false },
      },
      include: {
        client: { select: { fullName: true } },
        therapyNote: { select: { content: true } },
      },
      orderBy: { endedAt: 'desc' },
      take: 10,
    }),
    prisma.modalityState.findMany({
      where: { psychologistId, completedAt: null, client: { isDemo: false } },
      include: { client: { select: { fullName: true } } },
      take: 30,
    }),
    prisma.session.findMany({
      where: {
        psychologistId,
        status: 'SCHEDULED',
        scheduledAt: { gte: new Date(), lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
        client: { isDemo: false },
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
        .map((c) => redactName(c.fullName))
        .slice(0, 10)
        .join(', ')}${inactive.length > 10 ? ` +${inactive.length - 10} more` : ''}`,
    );
  }

  lines.push('');
  lines.push(`Upcoming sessions (next 7 days): ${upcomingSessions.length}`);
  for (const s of upcomingSessions.slice(0, 6)) {
    lines.push(
      `  - ${redactName(s.client.fullName)} (${s.modality}) on ${s.scheduledAt.toISOString().slice(0, 16).replace('T', ' ')}`,
    );
  }

  lines.push('');
  lines.push(
    `Sessions completed in last 7 days: ${recentSessions.filter((s) => s.endedAt && s.endedAt >= sevenDaysAgo).length}`,
  );
  lines.push(`Sessions completed in last 30 days: ${recentSessions.length}`);
  for (const s of recentSessions.slice(0, 5)) {
    const note = s.therapyNote?.content as
      | { riskFlags?: { severity?: string }; assessment?: string }
      | null
      | undefined;
    const severity = note?.riskFlags?.severity ?? 'unknown';
    const summary = note?.assessment?.split('.')[0]?.slice(0, 120) ?? '(no signed note)';
    lines.push(
      `  - ${redactName(s.client.fullName)} (${s.modality}, ${s.endedAt?.toISOString().slice(0, 10)}, risk: ${severity}): ${summary}`,
    );
  }

  if (workflows.length > 0) {
    lines.push('');
    lines.push('Active workflows:');
    for (const w of workflows.slice(0, 10)) {
      lines.push(`  - ${redactName(w.client.fullName)}: ${w.modality} in ${w.currentPhase}`);
    }
  }

  const highRisk = recentSessions.filter((s) => {
    const note = s.therapyNote?.content as { riskFlags?: { severity?: string } } | null | undefined;
    return note?.riskFlags?.severity === 'high' || note?.riskFlags?.severity === 'critical';
  });
  if (highRisk.length > 0) {
    lines.push('');
    lines.push(
      `High-risk recent sessions: ${highRisk.map((s) => redactName(s.client.fullName)).join(', ')}`,
    );
  }

  return lines.join('\n');
}
