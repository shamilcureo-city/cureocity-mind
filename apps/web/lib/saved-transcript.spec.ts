import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Utterance } from '@cureocity/contracts';
import { TranscriptTab } from '../components/app/TranscriptTab';
import {
  decodeSavedTranscript,
  encodeSavedTranscript,
  matchingTranscriptSegments,
  segmentsFromUtterances,
  transcriptParagraphs,
  TRANSCRIPTION_REVIEW_WARNING,
} from './saved-transcript';

beforeAll(() => vi.stubGlobal('React', React));
afterAll(() => vi.unstubAllGlobals());

const utterances: Utterance[] = [
  { id: 'u1', speaker: 'doctor', text: 'How have you been?', tStartMs: 100, tEndMs: 2000 },
  { id: 'u2', speaker: 'patient', text: 'ഇന്ന് better ആണ്.', tStartMs: 2200, tEndMs: 4100 },
  { id: 'u3', speaker: 'unknown', text: 'A quiet reply.', tStartMs: 4500, tEndMs: 4700 },
];
const raw = utterances.map((u) => u.text).join(' ');
const render = (overrides: Partial<React.ComponentProps<typeof TranscriptTab>['data']>) =>
  renderToStaticMarkup(
    React.createElement(TranscriptTab, {
      data: {
        status: 'COMPLETED',
        transcript: raw,
        segments: null,
        totalCostInr: '0',
        backend: null,
        errorMessage: null,
        ...overrides,
      },
    }),
  );

describe('encrypted saved transcript payload', () => {
  it('round-trips true roles, timestamps, code-mixed words and missing-window warning', () => {
    const speakerSegments = segmentsFromUtterances(utterances);
    const result = decodeSavedTranscript(encodeSavedTranscript(raw, speakerSegments, true));
    expect(result).toMatchObject({ transcript: raw, speakerSegments, transcriptionWarning: true });
    expect(result.speakerSegments?.map((s) => s.speaker)).toEqual([
      'therapist',
      'client',
      'unknown',
    ]);
    expect(result.speakerSegments?.[1]).toMatchObject({
      text: 'ഇന്ന് better ആണ്.',
      startMs: 2200,
      endMs: 4100,
    });
  });
  it('reads legacy strings, including JSON-looking speech, without invented labels', () => {
    for (const transcript of [raw, '{"feeling":"better"}', 'Therapist: A historical phrase.']) {
      expect(decodeSavedTranscript(transcript)).toEqual({
        transcript,
        speakerSegments: null,
        transcriptionWarning: false,
      });
    }
  });
  it('fails closed for a malformed recognized envelope instead of rendering serialized JSON as speech', () => {
    expect(() =>
      decodeSavedTranscript('{"format":"cureocity-transcript-v1","transcript":3}'),
    ).toThrow();
  });
  it('matches raw cumulative speech and the exact labelled browser fallback', () => {
    expect(matchingTranscriptSegments(raw, utterances)).toHaveLength(3);
    const labelled =
      'Therapist: How have you been?\nClient: ഇന്ന് better ആണ്.\nSpeaker: A quiet reply.';
    expect(matchingTranscriptSegments(labelled, utterances)).toHaveLength(3);
    expect(matchingTranscriptSegments(`${raw} Missing words.`, utterances)).toEqual([]);
    expect(matchingTranscriptSegments(raw, utterances.slice(0, 2))).toEqual([]);
  });
  it('adds visual paragraphs without changing the words or inventing conversation turns', () => {
    const long = Array.from({ length: 150 }, (_, i) => `വാക്ക്${i}`).join(' ');
    const paragraphs = transcriptParagraphs(long);
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs.join(' ')).toBe(long);
  });
});

describe('saved transcript reading surface', () => {
  it('renders actual conversation roles and times in readable bubbles', () => {
    const html = render({ segments: segmentsFromUtterances(utterances) });
    expect(html).toContain('Saved conversation');
    expect(html).toContain('Therapist');
    expect(html).toContain('Client');
    expect(html).toContain('Speaker not identified');
    expect(html).toContain('0:02');
    expect(html).toContain('ഇന്ന് better ആണ്.');
    expect(html).not.toContain('<pre');
  });
  it('renders old unlabelled records as body text with an honest explanation', () => {
    const html = render({});
    expect(html).toContain('we have not guessed who said what');
    expect(html).toContain('Saved transcript without speaker labels');
    expect(html).not.toContain('font-mono');
    expect(html).not.toContain('<pre');
  });
  it('warns about historical artifacts without silently rewriting the record', () => {
    const artifact =
      'PLACEHOLDER: Replace verbatim per PRD 22.1 Part 10.3 (pending Sharafath sign-off).';
    const html = render({ transcript: artifact });
    expect(html).toContain('role="alert"');
    expect(html).toContain('Do not sign or share');
    expect(html).toContain(artifact);
    expect(html).toContain('original record is unchanged');
  });
  it('keeps missing-window warnings visible with and without speaker segments', () => {
    expect(render({ transcriptionWarning: true })).toContain(TRANSCRIPTION_REVIEW_WARNING);
    expect(
      render({
        segments: segmentsFromUtterances(utterances),
        errorMessage: TRANSCRIPTION_REVIEW_WARNING,
      }),
    ).toContain(TRANSCRIPTION_REVIEW_WARNING);
  });
});
