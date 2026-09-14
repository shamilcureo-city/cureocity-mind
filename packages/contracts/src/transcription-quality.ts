/**
 * Recognisable model/development artifacts are not evidence of speech.
 * This is deliberately a narrow deny-list, not a general hallucination or
 * language detector: ordinary uses of "placeholder", names, code-mixing and
 * [inaudible] must remain untouched. Callers reject/quarantine the affected
 * result; this helper never rewrites clinical text or logs its contents.
 */
export function containsTranscriptionArtifact(text: string): boolean {
  const normalized = text.normalize('NFKC').replace(/\s+/gu, ' ').trim();
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
    )
  );
}
