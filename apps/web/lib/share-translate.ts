import { GoogleGenAI, HarmBlockThreshold, HarmCategory } from '@google/genai';
import type { ClinicalLocale } from '@cureocity/contracts';
import { ensureGcpCreds } from '@/lib/llm';

/**
 * Share-time translation of patient-facing text into the client's language,
 * WITHOUT touching the signed clinical record. The therapist keeps their note
 * in their working language; the client receives a translated copy in the
 * snapshot that's frozen onto the PatientShare row.
 *
 * Fail-safe by design: returns the original strings unchanged when translation
 * isn't available (non-Vertex backend, missing project) OR the model call
 * fails / returns a mismatched shape. A share must never break because a
 * translation didn't happen — worst case the client gets the original text.
 */

const LANGUAGE_NAME: Record<ClinicalLocale, string> = {
  en: 'English',
  ml: 'Malayalam',
  hi: 'Hindi',
  ta: 'Tamil',
  bn: 'Bengali',
};

export async function translateForShare(
  texts: string[],
  target: ClinicalLocale,
): Promise<string[]> {
  // Nothing to do for the base language or an empty set.
  if (texts.length === 0 || target === 'en') return texts;
  // Vertex-only — the mock backend has no translation capability. Passthrough
  // keeps dev / CI shares working (in the therapist's original language).
  if ((process.env['LLM_BACKEND'] ?? 'mock') !== 'vertex') return texts;
  const project = process.env['VERTEX_PROJECT_ID'];
  if (!project) return texts;

  try {
    ensureGcpCreds();
    const region = process.env['VERTEX_PRO_REGION'] ?? 'global';
    const model = process.env['VERTEX_PRO_MODEL'] ?? 'gemini-2.5-pro';
    const ai = new GoogleGenAI({ vertexai: true, project, location: region });
    const languageName = LANGUAGE_NAME[target];

    const res = await ai.models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: [
                `Translate each string in this JSON array into ${languageName} for a mental-health client to read on their phone.`,
                `Use warm, plain, everyday language. Keep the clinical meaning EXACT. Translate only — do not add, remove, summarise, or re-interpret anything. Leave proper names unchanged.`,
                `Return ONLY a JSON array of the translated strings, in the SAME order and with the SAME length as the input.`,
                '',
                JSON.stringify(texts),
              ].join('\n'),
            },
          ],
        },
      ],
      config: {
        responseMimeType: 'application/json',
        temperature: 0.2,
        maxOutputTokens: 8192,
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

    const parsed: unknown = JSON.parse(res.text ?? '[]');
    if (
      Array.isArray(parsed) &&
      parsed.length === texts.length &&
      parsed.every((s) => typeof s === 'string')
    ) {
      // Guard against the model blanking a field — fall back per-item.
      return parsed.map((s, i) => ((s as string).trim() ? (s as string) : (texts[i] ?? '')));
    }
    return texts;
  } catch {
    return texts;
  }
}
