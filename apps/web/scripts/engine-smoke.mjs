import { ModelRouter, MockGeminiPass1Backend, MockGeminiPass2Backend } from '@cureocity/llm';
import { TherapyNoteV1Schema } from '@cureocity/contracts';

const router = new ModelRouter({
  pass1: new MockGeminiPass1Backend(),
  pass2: new MockGeminiPass2Backend(),
});

const p1 = await router.pass1({
  sessionId: 'csmoke0000000000000000001',
  audioBytes: Buffer.alloc(0),
  durationMs: 1800_000,
});
console.log(
  'PASS1 transcript chars:',
  p1.output.transcript.length,
  '| segments:',
  p1.output.speakerSegments.length,
  '| costInr:',
  p1.callLog.costInr,
);

const p2 = await router.pass2({
  sessionId: 'csmoke0000000000000000001',
  transcript: p1.output.transcript,
  speakerSegments: p1.output.speakerSegments,
  modality: 'CBT',
  clientContext: { presentingConcerns: 'GAD, sleep' },
});
console.log(
  'PASS2 risk:',
  p2.output.therapyNote.riskFlags.severity,
  '| subjective chars:',
  p2.output.therapyNote.subjective.length,
  '| costInr:',
  p2.callLog.costInr,
);

const validated = TherapyNoteV1Schema.parse(p2.output.therapyNote);
console.log(
  'OK — TherapyNoteV1Schema accepts mock output. version:',
  validated.version,
  '| phaseHints:',
  validated.phaseHints.length,
);
