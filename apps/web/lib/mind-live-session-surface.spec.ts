import { describe, expect, it } from 'vitest';
import type { TherapyReasoningV1 } from '@cureocity/contracts';
import {
  focusedLiveSessionReasoning,
  liveSessionCapturePresentation,
} from './mind-live-session-surface';

const reasoning = {
  version: 3,
  riskWatch: [
    {
      id: 'risk-1',
      label: 'Review immediate safety',
      why: 'Fictional safety cue',
      severity: 'high',
      source: 'LIVE',
      sourceUtteranceIds: ['u-1'],
    },
  ],
  askNext: [
    {
      id: 'prepared-1',
      question: 'Prepared question',
      why: 'Carried into the session',
      source: 'CARRIED',
      priority: 'normal',
      status: 'open',
      sourceUtteranceIds: [],
    },
    {
      id: 'live-1',
      question: 'Live question',
      why: 'Fictional live context',
      source: 'LIVE',
      priority: 'normal',
      status: 'open',
      sourceUtteranceIds: ['u-1'],
    },
  ],
  threads: [
    {
      id: 'thread-1',
      topic: 'A topic to return to',
      note: 'Fictional thread',
      mentions: 1,
      sourceUtteranceIds: ['u-1'],
    },
  ],
  arc: { phase: 'working', elapsedMin: 18, plannedMin: 50, suggestion: 'Keep exploring.' },
} as TherapyReasoningV1;

describe('psychologist-first live session surface', () => {
  it('keeps every safety cue but exposes only one ordinary focus in Guided', () => {
    const focused = focusedLiveSessionReasoning(reasoning, 'guided', false)!;

    expect(focused.riskWatch).toEqual(reasoning.riskWatch);
    expect(focused.askNext.map((item) => item.id)).toEqual(['live-1']);
    expect(focused.threads).toEqual([]);
    expect(focused.arc).toBeNull();
  });

  it('shows only persistent safety in Quiet or while a prepared guide leads', () => {
    for (const focused of [
      focusedLiveSessionReasoning(reasoning, 'quiet', false)!,
      focusedLiveSessionReasoning(reasoning, 'guided', true)!,
    ]) {
      expect(focused.riskWatch).toEqual(reasoning.riskWatch);
      expect(focused.askNext).toEqual([]);
      expect(focused.threads).toEqual([]);
      expect(focused.arc).toBeNull();
    }
  });

  it('advances to one thread, then pacing, only when no question leads', () => {
    const withoutQuestions = { ...reasoning, askNext: [] };
    const thread = focusedLiveSessionReasoning(withoutQuestions, 'guided', false)!;
    expect(thread.threads.map((item) => item.id)).toEqual(['thread-1']);
    expect(thread.arc).toBeNull();

    const pacing = focusedLiveSessionReasoning(
      { ...withoutQuestions, threads: [] },
      'guided',
      false,
    )!;
    expect(pacing.askNext).toEqual([]);
    expect(pacing.threads).toEqual([]);
    expect(pacing.arc).toEqual(reasoning.arc);
  });

  it('names microphone and connection truthfully across capture states', () => {
    expect(
      liveSessionCapturePresentation({
        phase: 'listening',
        consentBlocked: false,
        reconnecting: false,
        connectionLost: false,
      }),
    ).toMatchObject({ status: 'Listening', detail: expect.stringContaining('Microphone on') });

    expect(
      liveSessionCapturePresentation({
        phase: 'connecting',
        consentBlocked: false,
        reconnecting: true,
        connectionLost: true,
      }),
    ).toMatchObject({
      status: 'Reconnecting',
      detail: expect.stringContaining('not yet confirmed'),
    });

    expect(
      liveSessionCapturePresentation({
        phase: 'finalizing',
        consentBlocked: false,
        reconnecting: false,
        connectionLost: false,
      }),
    ).toMatchObject({ status: 'Processing', detail: expect.stringContaining('Microphone off') });

    expect(
      liveSessionCapturePresentation({
        phase: 'paused',
        consentBlocked: false,
        reconnecting: false,
        connectionLost: false,
      }),
    ).toMatchObject({ status: 'Paused', detail: expect.stringContaining('No new audio') });

    expect(
      liveSessionCapturePresentation({
        phase: 'done',
        consentBlocked: false,
        reconnecting: false,
        connectionLost: false,
      }),
    ).toMatchObject({
      status: 'Stopped',
      detail: expect.stringContaining('until the transcript and note are confirmed saved'),
    });
  });
});
