/**
 * Recognisable model/development artifacts are not evidence of speech.
 * This is deliberately a narrow deny-list, not a general hallucination or
 * language detector: ordinary uses of "placeholder", names, code-mixing and
 * [inaudible] must remain untouched. Callers reject/quarantine the affected
 * result; this helper never rewrites clinical text or logs its contents.
 */
const CONTROL_METADATA_KEYS = new Set(['promptVersion', 'systemInstruction', 'systemPrompt']);

function containsArtifactValue(value: unknown): boolean {
  if (typeof value === 'string') {
    if (containsArtifactText(value)) return true;
    const trimmed = value.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false;
    try {
      return containsArtifactValue(JSON.parse(trimmed));
    } catch {
      return false;
    }
  }
  if (Array.isArray(value)) return value.some(containsArtifactValue);
  if (value && typeof value === 'object') {
    return Object.entries(value).some(
      ([key, nested]) => CONTROL_METADATA_KEYS.has(key) || containsArtifactValue(nested),
    );
  }
  return false;
}

function containsArtifactText(text: string): boolean {
  // Preserve line boundaries so prompt fragments appended after real speech are
  // still detectable. Collapsing every whitespace character into one space
  // made a later turn indistinguishable from ordinary words inside a sentence.
  const normalized = text
    .normalize('NFKC')
    .replace(/[^\S\r\n]+/gu, ' ')
    .replace(/\r\n?/gu, '\n')
    .replace(/\n+/gu, '\n')
    .trim();
  return (
    /\bplaceholder:\s*(?:replace verbatim per prd\b|refine verbatim wording before pilot\b)/iu.test(
      normalized,
    ) ||
    /\breplace verbatim per prd \d+(?:\.\d+)*(?: part \d+(?:\.\d+)*)? \(pending (?:sharafath|clinical) sign[- ]off\)/iu.test(
      normalized,
    ) ||
    /\bplaceholder:\s*(?:this is )?a placeholder for (?:the )?audio transcription\b/iu.test(
      normalized,
    ) ||
    /\bthis is a placeholder for the audio transcription\. the actual transcription will be generated based on (?:the (?:provided )?|provided )?audio input\b/iu.test(
      normalized,
    ) ||
    // Pre-fix live routes used these presence markers as if they were spoken
    // words. They are transport metadata, not an authoritative transcript.
    /\(\s*captured via live (?:scribe|copilot)\s*\)/iu.test(normalized) ||
    // Provider/chat-template control tokens are never clinical speech. Keep
    // this list exact so ordinary discussion of prompts or AI is preserved.
    /(?:<\|(?:im_start|im_end|system|assistant|user)\|>|<<\s*SYS\s*>>|\[\/?INST\])/iu.test(
      normalized,
    ) ||
    /(?:^|[.!?]\s+|\n\s*)(?:system|developer) (?:prompt|message|instruction)s?\s*:\s*(?:you are|follow|ignore|output|respond|return)\b/iu.test(
      normalized,
    ) ||
    // Exact runtime-prompt/model-refusal fragments catch prompt echoes without
    // classifying generic phrases such as "we discussed a system prompt".
    /(?:^|[.!?]\s+|\n\s*)you are an expert (?:clinical|medical) scribe for an indian (?:psychotherapy practice|super-specialty opd)\b/iu.test(
      normalized,
    ) ||
    /(?:^|[.!?]\s+|\n\s*)task\s*[—:-]\s*produce strict json with four fields\b/iu.test(
      normalized,
    ) ||
    /(?:^|[.!?]\s+|\n\s*)output\s*:\s*strict json matching the schema\. no prose, no markdown\b/iu.test(
      normalized,
    ) ||
    /(?:^|[.!?]\s+|\n\s*)(?:assistant\s*:\s*)?as an ai language model,\s*i cannot transcribe (?:this|the) (?:recording|audio)(?:[.!]|$)/iu.test(
      normalized,
    )
  );
}

export function containsTranscriptionArtifact(text: string): boolean {
  return containsArtifactValue(text);
}
