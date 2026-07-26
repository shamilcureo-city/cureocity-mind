import { NextResponse, type NextRequest } from 'next/server';
import { GoogleGenAI, HarmBlockThreshold, HarmCategory } from '@google/genai';
import { DraftPostInputSchema, type DraftPostResponse } from '@cureocity/contracts';
import { appMockRefusalReason, ensureGcpCreds, resolveThinkingBudget } from '@/lib/llm';
import { requirePsychologistId } from '@/lib/auth-server';
import { parseJson } from '@/lib/validate';
import { prisma } from '@/lib/prisma';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * MK5 — draft a profile post on a topic the therapist chose. Grounded
 * in DECLARED expertise (specialties/modalities/languages) — never in
 * session or client data; that line is deliberate (Klarify drafts from
 * "your sessions, names removed" — we refuse that even anonymised).
 * Draft-only: the result lands in the editor as a DRAFT post.
 */

const SYSTEM = `You write short public articles for an Indian therapist's professional page.

Rules — safety rules, not style suggestions:
- Ground the article in the therapist's DECLARED expertise facts provided. Never invent credentials, statistics, studies, or client stories.
- Psychoeducation only: what the topic is, how it commonly shows up, evidence-based coping directions, and when to seek professional help. NO diagnosis, NO treatment promises, NO medical claims.
- 350–600 words, plain English an anxious first-time reader can follow. Short paragraphs. Warm, non-judgemental.
- End with one sentence inviting the reader to reach out if this feels familiar.
- Output STRICT JSON: { "title": "...", "body": "..." } — body is plain text paragraphs separated by blank lines. No markdown headers.`;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const body = await parseJson(req, DraftPostInputSchema);
  if (!body.ok) return body.response;
  const psyId = auth.value.psychologistId;

  const psy = await prisma.psychologist.findUnique({
    where: { id: psyId },
    select: { specialties: true, modalities: true, languages: true, locationCity: true },
  });
  if (!psy) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const facts = [
    `Topic requested: ${body.value.topic}`,
    psy.specialties.length ? `Therapist's specialties: ${psy.specialties.join(', ')}` : null,
    psy.modalities.length ? `Approaches used: ${psy.modalities.join(', ')}` : null,
    psy.locationCity ? `City: ${psy.locationCity}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const llmBackend = process.env['LLM_BACKEND'] ?? 'mock';
  let out: DraftPostResponse;

  if (llmBackend !== 'vertex') {
    const refusal = appMockRefusalReason();
    if (refusal) {
      console.error(`[post-draft] ${refusal}`);
      return NextResponse.json(
        { error: 'AI drafting is unavailable in this environment.' },
        { status: 503 },
      );
    }
    out = {
      title: `[mock] Understanding ${body.value.topic}`,
      body: `[mock] ${body.value.topic} is something many people quietly carry. This draft explains how it commonly shows up, what tends to help, and when talking to a professional makes sense.\n\nIf any of this feels familiar, you're welcome to reach out.`,
      source: 'mock',
    };
  } else {
    ensureGcpCreds();
    const project = process.env['VERTEX_PROJECT_ID'];
    if (!project) {
      return NextResponse.json({ error: 'VERTEX_PROJECT_ID not set' }, { status: 500 });
    }
    const ai = new GoogleGenAI({
      vertexai: true,
      project,
      location: process.env['VERTEX_PRO_REGION'] ?? 'global',
    });
    const res = await ai.models.generateContent({
      model: process.env['VERTEX_FLASH_MODEL'] ?? 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: `${facts}\n\nWrite the article JSON now.` }] }],
      config: {
        systemInstruction: SYSTEM,
        responseMimeType: 'application/json',
        temperature: 0.6,
        maxOutputTokens: 4096,
        ...(resolveThinkingBudget('LLM_THINKING_BUDGET_MARKETING', 1024) !== undefined && {
          thinkingConfig: {
            thinkingBudget: resolveThinkingBudget('LLM_THINKING_BUDGET_MARKETING', 1024),
          },
        }),
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
    const text = (res.text ?? '').trim();
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first < 0 || last <= first) {
      return NextResponse.json(
        { error: 'The draft came back unreadable — try again.' },
        { status: 502 },
      );
    }
    try {
      const obj = JSON.parse(text.slice(first, last + 1)) as { title?: unknown; body?: unknown };
      if (typeof obj.title !== 'string' || typeof obj.body !== 'string') throw new Error('shape');
      out = { title: obj.title.slice(0, 160), body: obj.body.slice(0, 20_000), source: 'vertex' };
    } catch {
      return NextResponse.json(
        { error: 'The draft came back unreadable — try again.' },
        { status: 502 },
      );
    }
  }

  await writeAudit({
    actorType: 'PSYCHOLOGIST',
    actorPsychologistId: psyId,
    action: 'PROFILE_AI_DRAFTED',
    targetType: 'Psychologist',
    targetId: psyId,
    metadata: { kind: 'post', topic: body.value.topic, source: out.source },
  });
  return NextResponse.json(out);
}
