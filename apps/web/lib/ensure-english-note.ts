import { GoogleGenAI, HarmBlockThreshold, HarmCategory } from '@google/genai';
import {
  IntakeNoteV1Schema,
  TherapyNoteV1Schema,
  type IntakeNoteV1,
  type SessionKind,
  type TherapyNoteV1,
} from '@cureocity/contracts';
import { noteNeedsEnglishTranslation } from '@cureocity/llm';
import { ensureGcpCreds } from './llm';

/**
 * Sprint TS-fix — guarantee the clinician-facing note is in English.
 *
 * Pass 2 is prompted to translate any non-English transcript to English, but a
 * Malayalam/Hindi-dominant transcript can make the model echo the source
 * language anyway (the "the note is in Malayalam but it says English" bug). As
 * a deterministic backstop, this detects a note whose text is substantially in
 * a non-English Indic script and translates it to English with one fast Flash
 * call BEFORE the note is persisted / shown.
 *
 * BEST-EFFORT by design: on a non-Vertex backend, a missing project, a model
 * error, a bad parse, or a still-non-English result it returns the ORIGINAL
 * note unchanged — it can never make a note worse or fail note generation.
 * `linkedEvidence[].quote` verbatim quotes are left in the original language.
 */

const TRANSLATE_SYSTEM = `You translate a clinical note's narrative fields into fluent clinical English.
Output STRICT JSON with the SAME schema, field names, types, and structure as the input.
Translate every narrative text field; keep riskFlags.severity, numbers, dates, and proper names unchanged.
Do NOT translate linkedEvidence[].quote strings — leave those verbatim in the original language.
No prose, no markdown, no commentary.`;

const SAFETY_OFF = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.OFF },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.OFF },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.OFF },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.OFF },
];

export async function ensureEnglishNote<T extends TherapyNoteV1 | IntakeNoteV1>(
  note: T,
  kind: SessionKind,
): Promise<T> {
  // Only meaningful on the real backend; mock/dev never mistranslates.
  if ((process.env['LLM_BACKEND'] ?? 'mock') !== 'vertex') return note;
  if (!noteNeedsEnglishTranslation(note)) return note;

  try {
    ensureGcpCreds();
    const project = process.env['VERTEX_PROJECT_ID'];
    if (!project) return note;
    const region = process.env['VERTEX_PRO_REGION'] ?? 'global';
    // Fast Flash rewrite — same tier the /note/modify translate uses.
    const model =
      process.env['VERTEX_MODIFY_MODEL'] ?? process.env['VERTEX_FLASH_MODEL'] ?? 'gemini-2.5-flash';
    const ai = new GoogleGenAI({ vertexai: true, project, location: region });
    const isIntake = kind === 'INTAKE';

    const res = await ai.models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: [
                `Current ${isIntake ? 'IntakeNoteV1' : 'TherapyNoteV1'} JSON (some fields are in a non-English Indian language):`,
                JSON.stringify(note, null, 2),
                '',
                'Translate every narrative field into English and output the full translated JSON only.',
              ].join('\n'),
            },
          ],
        },
      ],
      config: {
        systemInstruction: TRANSLATE_SYSTEM,
        responseMimeType: 'application/json',
        temperature: 0.1,
        maxOutputTokens: 8192,
        thinkingConfig: { thinkingBudget: 0 },
        safetySettings: SAFETY_OFF,
      },
    });

    const candidate = JSON.parse(res.text ?? '{}') as Record<string, unknown>;
    // Force-preserve the fields the translator must never silently change:
    // riskFlags.severity (and modality on therapy notes).
    const orig = note as unknown as {
      riskFlags: { severity: string; indicators: string[]; details?: string };
      modality?: string;
    };
    const cand = candidate as {
      riskFlags?: { indicators?: string[]; details?: string };
      modality?: string;
    };
    const merged = {
      ...note,
      ...candidate,
      riskFlags: {
        ...orig.riskFlags,
        ...(cand.riskFlags ?? {}),
        severity: orig.riskFlags.severity,
      },
      ...(orig.modality !== undefined && { modality: orig.modality }),
    };
    const validated = (
      isIntake ? IntakeNoteV1Schema.parse(merged) : TherapyNoteV1Schema.parse(merged)
    ) as T;

    // If the "translation" is still non-English (no-op / garbled), keep the
    // original rather than swap in something no better.
    if (noteNeedsEnglishTranslation(validated)) return note;
    return validated;
  } catch (e) {
    console.warn(
      `[ensure-english-note] translate failed; keeping original note: ${(e as Error).message}`,
    );
    return note;
  }
}
