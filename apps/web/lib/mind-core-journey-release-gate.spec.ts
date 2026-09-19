import { describe, expect, it } from 'vitest';
import type { TherapyReasoningV1 } from '@cureocity/contracts';
import { mindSessionPhaseForStatus } from '../components/app/MindSessionPhaseRail';
import { deriveMindSessionCloseout } from './mind-session-closeout';
import { mindStartEntryHref } from './mind-session-start';
import {
  focusedLiveSessionReasoning,
  liveSessionCapturePresentation,
} from './mind-live-session-surface';

const fictionalReasoning = {
  version: 3,
  riskWatch: [
    {
      id: 'risk-1',
      label: 'Review immediate safety',
      why: 'Fictional safety cue',
      severity: 'high',
      source: 'LIVE',
      sourceUtteranceIds: ['utterance-1'],
    },
  ],
  askNext: [
    {
      id: 'live-question',
      question: 'What feels most important to understand next?',
      why: 'Fictional live context',
      source: 'LIVE',
      priority: 'normal',
      status: 'open',
      sourceUtteranceIds: ['utterance-1'],
    },
    {
      id: 'prepared-question',
      question: 'Prepared follow-up',
      why: 'Fictional preparation',
      source: 'CARRIED',
      priority: 'normal',
      status: 'open',
      sourceUtteranceIds: [],
    },
  ],
  threads: [
    {
      id: 'thread-1',
      topic: 'A topic to return to',
      note: 'Fictional context',
      mentions: 1,
      sourceUtteranceIds: ['utterance-1'],
    },
  ],
  arc: null,
} as TherapyReasoningV1;

describe('Mind core psychologist journey release gate', () => {
  it('keeps one coherent Prepare → Session → Review path without redirecting Scribe', () => {
    expect(mindSessionPhaseForStatus('SCHEDULED')).toBe('prepare');
    expect(
      mindStartEntryHref({
        source: 'TODAY',
        clientId: 'fictional-client',
        sessionId: 'fictional-session',
        captureMode: 'LIVE',
        vertical: 'THERAPIST',
      }),
    ).toBe('/app?record=fictional-client&session=fictional-session&capture=LIVE');

    expect(mindSessionPhaseForStatus('IN_PROGRESS')).toBe('session');
    expect(
      liveSessionCapturePresentation({
        phase: 'listening',
        consentBlocked: false,
        reconnecting: false,
        connectionLost: false,
      }),
    ).toMatchObject({ status: 'Listening', detail: expect.stringContaining('Microphone on') });

    const quiet = focusedLiveSessionReasoning(fictionalReasoning, 'quiet', false)!;
    expect(quiet.riskWatch).toHaveLength(1);
    expect(quiet.askNext).toEqual([]);

    const guided = focusedLiveSessionReasoning(fictionalReasoning, 'guided', false)!;
    expect(guided.riskWatch).toHaveLength(1);
    expect(guided.askNext.map((item) => item.id)).toEqual(['live-question']);
    expect(guided.threads).toEqual([]);

    expect(mindSessionPhaseForStatus('COMPLETED')).toBe('review');
    const closeout = deriveMindSessionCloseout({
      draftStatus: 'COMPLETED',
      noteSigned: false,
    });
    expect(closeout.status).toBe('REVIEW_AND_CLOSE');
    expect(closeout.steps.signed).toBe('PENDING');
    expect(closeout.steps.shared).toBe('PENDING');

    expect(
      mindStartEntryHref({
        source: 'CLIENT',
        clientId: 'patient-1',
        captureMode: 'LIVE',
        vertical: 'DOCTOR',
        doctorHref: '/app/patients/patient-1',
      }),
    ).toBe('/app/patients/patient-1');
  });
});
