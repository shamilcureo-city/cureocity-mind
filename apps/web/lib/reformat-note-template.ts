import { Prisma } from '@prisma/client';
import { IntakeNoteV1Schema, TherapyNoteV1Schema } from '@cureocity/contracts';
import { computeCostInr, PRO_PRICING } from '@cureocity/llm';
import { modelRouter } from './llm';
import { checkCostCircuit } from './cost-guard';
import { noteContainsArtifact } from './note-artifact';
import { prisma } from './prisma';

/** Render only from the clinician's current note. The model may change the
 * optional template view but cannot overwrite any clinical or safety field. */
export async function reformatNoteTemplate(input: {
  sessionId: string;
  psychologistId: string;
  kind: 'INTAKE' | 'TREATMENT';
  content: unknown;
  template: { name: string; sections: { title: string; hint?: string }[] } | null;
}) {
  const current =
    input.kind === 'INTAKE'
      ? IntakeNoteV1Schema.parse(input.content)
      : TherapyNoteV1Schema.parse(input.content);
  if (noteContainsArtifact(current))
    throw new Error('Correct invalid generated text before changing format.');
  const next = { ...current };
  delete next.templateSections;
  if (!input.template) return next;
  const source = { ...next };
  delete (source as Record<string, unknown>).summary;
  delete (source as Record<string, unknown>).topics;
  const transcript = `Reformat only this clinician-reviewed note. Do not invent missing details. Preserve all statements and uncertainty.\n${JSON.stringify(source)}`;
  await checkCostCircuit({
    sessionId: input.sessionId,
    psychologistId: input.psychologistId,
    estimatedCostInr: computeCostInr(Math.ceil(transcript.length / 3), 4000, PRO_PRICING),
  });
  const result = await modelRouter().pass2({
    sessionId: input.sessionId,
    transcript,
    speakerSegments: [],
    vertical: 'THERAPIST',
    kind: input.kind,
    modality: 'modality' in current ? current.modality : null,
    clientContext: {},
    template: input.template,
  });
  const log = result.callLog;
  // Usage is real even when a later conflict prevents applying the new view.
  await prisma.geminiCallLog.create({
    data: {
      sessionId: input.sessionId,
      pass: log.pass,
      model: log.model,
      region: log.region,
      promptVersion: log.promptVersion,
      inputTokens: log.inputTokens,
      outputTokens: log.outputTokens,
      costInr: new Prisma.Decimal(log.costInr),
      latencyMs: log.latencyMs,
      status: log.status,
    },
  });
  const projected =
    result.output.kind === 'INTAKE'
      ? result.output.intakeNote
      : result.output.kind === 'TREATMENT'
        ? result.output.therapyNote
        : null;
  const sections = projected?.templateSections;
  if (
    !sections ||
    sections.length !== input.template.sections.length ||
    sections.some((section, index) => section.title !== input.template!.sections[index]!.title) ||
    noteContainsArtifact(sections)
  )
    throw new Error('The new format could not be prepared. Your note has not changed.');
  return { ...next, templateSections: sections };
}
