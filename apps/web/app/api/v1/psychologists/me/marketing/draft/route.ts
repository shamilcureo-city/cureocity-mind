import { NextResponse, type NextRequest } from 'next/server';
import { GoogleGenAI, HarmBlockThreshold, HarmCategory } from '@google/genai';
import type { DraftMarketingResponse, ProfileFaq } from '@cureocity/contracts';
import { appMockRefusalReason, ensureGcpCreds, resolveThinkingBudget } from '@/lib/llm';
import { requirePsychologistId } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * POST /api/v1/psychologists/me/marketing/draft — MK3 AI auto-fill.
 *
 * Drafts headline + bio + FAQs GROUNDED in what the practice data
 * already proves: declared specialties/modalities/languages/city, and
 * the aggregate count of completed sessions per modality. No client
 * information ever enters the prompt — aggregate practice facts only.
 *
 * Draft-only by construction: the response lands in the studio editor
 * and the therapist approves every word before anything persists.
 * Same mock policy as practice-assistant/chat: mock is refused on any
 * deployed environment (503), allowed on a local machine.
 */

function buildSystemPrompt(): string {
  return `You write public profile copy for Indian therapists in private practice.

Rules — these are safety rules, not style suggestions:
- Use ONLY the facts provided. NEVER invent credentials, degrees, years of experience, client outcomes, or testimonials.
- If a fact is absent, write around it — do not guess.
- First person, warm, specific, plain English. No clinical jargon a patient wouldn't know, no superlatives ("best", "top"), no medical-outcome promises (advertising rules).
- headline: one line, ≤140 chars, what the therapist helps with — not a slogan.
- bio: 120–200 words, 2–3 short paragraphs. Who they work with, how sessions feel, practical details (languages, online/in-person).
- faqs: 4–5 question/answer pairs a prospective client actually asks (online sessions, first-session shape, languages, confidentiality). Answers 1–3 sentences, grounded in the facts.
- Output STRICT JSON: { "headline": "...", "bio": "...", "faqs": [{ "q": "...", "a": "..." }] } — no prose, no markdown.`;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const psyId = auth.value.psychologistId;

  const psy = await prisma.psychologist.findUnique({
    where: { id: psyId },
    select: {
      vertical: true,
      fullName: true,
      specialties: true,
      modalities: true,
      languages: true,
      yearsOfExperience: true,
      locationCity: true,
      credentialsLine: true,
      sessionFeeInr: true,
      defaultOutputLanguage: true,
    },
  });
  if (!psy) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (psy.vertical !== 'THERAPIST') {
    return NextResponse.json(
      { error: 'Marketing pages are therapist-only in V1' },
      { status: 409 },
    );
  }

  // Aggregate practice fact: which modalities they actually run.
  const sessionsByModality = await prisma.session.groupBy({
    by: ['modality'],
    where: { psychologistId: psyId, status: 'COMPLETED' },
    _count: { _all: true },
  });
  const practisedModalities = sessionsByModality
    .filter((g) => g.modality && g.modality !== 'INTAKE' && g._count._all >= 3)
    .map((g) => `${g.modality} (${g._count._all} sessions)`);

  const facts = [
    `Name: ${psy.fullName}`,
    psy.credentialsLine ? `Credentials: ${psy.credentialsLine}` : null,
    psy.specialties.length ? `Specialties: ${psy.specialties.join(', ')}` : null,
    psy.modalities.length ? `Declared approaches: ${psy.modalities.join(', ')}` : null,
    practisedModalities.length
      ? `Approaches evidenced by completed sessions: ${practisedModalities.join(', ')}`
      : null,
    psy.languages.length ? `Languages: ${psy.languages.join(', ')}` : null,
    psy.yearsOfExperience !== null ? `Years of experience: ${psy.yearsOfExperience}` : null,
    psy.locationCity ? `City: ${psy.locationCity}` : null,
    psy.sessionFeeInr !== null ? `Fee: ₹${psy.sessionFeeInr} per session` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const llmBackend = process.env['LLM_BACKEND'] ?? 'mock';
  let body: DraftMarketingResponse;

  if (llmBackend !== 'vertex') {
    const refusal = appMockRefusalReason();
    if (refusal) {
      console.error(`[marketing-draft] ${refusal}`);
      return NextResponse.json(
        { error: 'AI drafting is unavailable in this environment.' },
        { status: 503 },
      );
    }
    body = { ...mockDraft(psy.fullName, psy.specialties, psy.languages), source: 'mock' };
  } else {
    ensureGcpCreds();
    const project = process.env['VERTEX_PROJECT_ID'];
    if (!project) {
      return NextResponse.json({ error: 'VERTEX_PROJECT_ID not set' }, { status: 500 });
    }
    const region = process.env['VERTEX_PRO_REGION'] ?? 'global';
    const model = process.env['VERTEX_FLASH_MODEL'] ?? 'gemini-2.5-flash';
    const ai = new GoogleGenAI({ vertexai: true, project, location: region });
    const res = await ai.models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: [{ text: `Facts about this practice:\n${facts}\n\nDraft the profile JSON now.` }],
        },
      ],
      config: {
        systemInstruction: buildSystemPrompt(),
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
    const parsed = parseDraft(res.text ?? '');
    if (!parsed) {
      return NextResponse.json(
        { error: 'The draft came back unreadable — try again.' },
        { status: 502 },
      );
    }
    body = { ...parsed, source: 'vertex' };
  }

  await writeAudit({
    actorType: 'PSYCHOLOGIST',
    actorPsychologistId: psyId,
    action: 'PROFILE_AI_DRAFTED',
    targetType: 'Psychologist',
    targetId: psyId,
    metadata: { source: body.source, factsChars: facts.length },
  });
  return NextResponse.json(body);
}

function parseDraft(raw: string): { headline: string; bio: string; faqs: ProfileFaq[] } | null {
  let s = raw.trim();
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence?.[1]) s = fence[1].trim();
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first < 0 || last <= first) return null;
  try {
    const obj = JSON.parse(s.slice(first, last + 1)) as {
      headline?: unknown;
      bio?: unknown;
      faqs?: unknown;
    };
    if (typeof obj.headline !== 'string' || typeof obj.bio !== 'string') return null;
    const faqs = Array.isArray(obj.faqs)
      ? obj.faqs
          .filter(
            (f): f is { q: string; a: string } =>
              typeof (f as { q?: unknown }).q === 'string' &&
              typeof (f as { a?: unknown }).a === 'string',
          )
          .slice(0, 6)
      : [];
    return { headline: obj.headline.slice(0, 160), bio: obj.bio.slice(0, 4000), faqs };
  } catch {
    return null;
  }
}

/** Deterministic dev draft so the studio flow works offline. */
function mockDraft(
  fullName: string,
  specialties: string[],
  languages: string[],
): { headline: string; bio: string; faqs: ProfileFaq[] } {
  const area = specialties[0] ?? 'life challenges';
  const langs = languages.length ? languages.join(' and ') : 'English';
  return {
    headline: `[mock] Helping adults work through ${area.toLowerCase()}, one steady step at a time`,
    bio: `[mock] I'm ${fullName}, and I work with adults navigating ${specialties.join(', ').toLowerCase() || 'difficult seasons'}. Sessions with me are practical and unhurried — we look at what's actually happening in your week and build skills you can use between sessions.

I work in ${langs}, online and in person. If you're not sure therapy is for you, a first conversation is a low-stakes way to find out.`,
    faqs: [
      {
        q: 'Do you offer online sessions?',
        a: '[mock] Yes — most sessions happen on video. Pick any slot marked online.',
      },
      {
        q: 'What happens in the first session?',
        a: '[mock] We talk about what brings you in and what you want to change. No preparation needed.',
      },
      {
        q: 'Is what I share confidential?',
        a: '[mock] Yes. What you share stays between us, within the standard legal limits I explain up front.',
      },
    ],
  };
}
