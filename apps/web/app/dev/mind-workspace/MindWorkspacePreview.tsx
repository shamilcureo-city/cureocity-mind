'use client';

import { useState, type MouseEvent } from 'react';
import { TherapyReasoningV1Schema, TherapyScriptV1Schema } from '@cureocity/contracts';
import { Sidebar } from '@/components/app/Sidebar';
import {
  MindTodayWorkspace,
  type MindTodayWorkspaceProps,
} from '@/components/app/MindTodayWorkspace';
import { MindSessionReviewHeader } from '@/components/app/MindSessionReviewHeader';
import { MindTherapyGuide } from '@/components/app/MindTherapyGuide';
import { TherapyCopilotRail } from '@/components/app/TherapyCopilotRail';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';
import styles from './preview.module.css';

type View = 'Today' | 'Guide' | 'Live' | 'Review';

const exampleSession: NonNullable<MindTodayWorkspaceProps['hero']> = {
  id: 'preview-session-a',
  status: 'SCHEDULED',
  scheduledAt: '2026-09-05T08:30:00.000Z',
  modality: 'SUPPORTIVE',
  kind: 'TREATMENT',
  clientId: 'preview-client-a',
  clientName: 'Example client A',
  clientIsDemo: true,
  hasSignedNote: false,
  draftStatus: null,
  captureMode: 'LIVE',
};

const script = TherapyScriptV1Schema.parse({
  version: 'V1',
  language: 'en',
  therapyName: 'A collaborative check-in',
  openingScript: 'What would feel most useful for us to make space for today?',
  mainExercise: {
    steps: [
      {
        id: 'focus',
        purpose: 'Choose a shared focus',
        therapistSays:
          'You mentioned a few things you would like to explore. Where would you like to begin?',
        listenFor: 'The client’s priorities and whether the proposed agenda fits them.',
        branches: [
          {
            ifClientSays: 'I am not sure where to start.',
            thenDo:
              'We can take a moment. Would it help to revisit what stood out since our last conversation?',
          },
        ],
      },
      {
        id: 'explore',
        purpose: 'Explore one recent situation',
        therapistSays:
          'Could you walk me through a moment that captures what this week has been like?',
        listenFor:
          'The client’s own words, context, and meaning; leave room to correct your understanding.',
        branches: [],
      },
      {
        id: 'reflect',
        purpose: 'Reflect together',
        therapistSays:
          'What feels most important about what we have discussed? Is there anything I have misunderstood?',
        listenFor: 'Agreement, disagreement, and anything the client wants to return to.',
        branches: [],
      },
    ],
  },
  adaptationCues: [
    'This is fictional interface content, not a validated therapy protocol.',
    'Change or skip a section to follow the client’s priorities.',
  ],
  closingScript: 'What would you like to take from today, and what should we return to next time?',
  homework: {
    description: 'Discuss whether any between-session activity would be useful.',
    deliveryNotes: 'Only record or share an activity if it is actually agreed with the client.',
  },
  riskWatchpoints: [
    'Pause the draft guide if a new concern requires the psychologist’s attention.',
  ],
  estimatedDurationMin: 45,
});

const initialReasoning = TherapyReasoningV1Schema.parse({
  riskWatch: [
    {
      id: 'preview-risk',
      label: 'Example safety check',
      why: 'Fictional cue used to verify that safety concerns remain visible in Quiet mode.',
      severity: 'medium',
      source: 'LIVE',
      sourceUtteranceIds: ['preview-u3'],
    },
  ],
  askNext: [
    {
      id: 'preview-plan-1',
      question: 'What would you like us to make time for today?',
      why: 'A prepared example question about the client’s priorities.',
      source: 'CARRIED',
      priority: 'normal',
      status: 'open',
      sourceUtteranceIds: [],
    },
    {
      id: 'preview-plan-2',
      question: 'Is the previous session’s focus still useful?',
      why: 'A second prepared question to exercise progressive disclosure.',
      source: 'CARRIED',
      priority: 'normal',
      status: 'open',
      sourceUtteranceIds: [],
    },
    {
      id: 'preview-live-1',
      question: 'What was different about that particular day?',
      why: 'An example contextual follow-up, drawn from the fictional transcript.',
      source: 'LIVE',
      priority: 'normal',
      status: 'open',
      sourceUtteranceIds: ['preview-u1'],
    },
    {
      id: 'preview-live-2',
      question: 'What would you like me to understand about it?',
      why: 'Another fictional follow-up to check the expanded view.',
      source: 'LIVE',
      priority: 'normal',
      status: 'open',
      sourceUtteranceIds: ['preview-u2'],
    },
  ],
  threads: [
    {
      id: 'preview-thread',
      topic: 'Changes in the daily routine',
      note: 'A fictional theme to revisit if the client wants to.',
      mentions: 1,
      sourceUtteranceIds: ['preview-u1'],
    },
  ],
  arc: {
    phase: 'working',
    elapsedMin: 18,
    plannedMin: 45,
    suggestion: 'Example pacing display. The psychologist decides when to change focus.',
  },
  version: 1,
});

export function MindWorkspacePreview() {
  const [view, setView] = useState<View>('Today');
  const [mode, setMode] = useState<'quiet' | 'guided'>('quiet');
  const [reasoning, setReasoning] = useState(initialReasoning);
  const [notice, setNotice] = useState('All names, notes and activity below are fictional.');

  // The real components retain their normal links. In this local gallery,
  // intercept those destinations and administrative actions before their
  // handlers can navigate, submit a form or change a record.
  function keepPreviewLocal(event: MouseEvent<HTMLDivElement>) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest('a');
    if (anchor) {
      event.preventDefault();
      event.stopPropagation();
      const href = anchor.getAttribute('href') ?? '';
      if (href.includes('/encounters/new') || href.includes('/live')) setView('Live');
      else if (
        href.includes('tab=note') ||
        href.includes('/notes-due') ||
        href.includes('/sessions/')
      )
        setView('Review');
      else if (href.includes('/today')) setView('Today');
      else
        setNotice(
          'Navigation is contained in this preview. No account or client record was opened.',
        );
    }
    const button = target.closest('button');
    if (button && /no.?show|reschedule|sign out/i.test(button.textContent ?? '')) {
      event.preventDefault();
      event.stopPropagation();
      setNotice('Schedule and account changes are disabled in this local preview.');
    }
  }

  function resolveExample(
    id: string,
    kind: 'ASK_NEXT' | 'RED_FLAG' | 'GAP',
    event: 'acted' | 'dismissed',
  ) {
    setReasoning((current) => ({
      ...current,
      riskWatch:
        kind === 'RED_FLAG'
          ? current.riskWatch.filter((item) => item.id !== id)
          : current.riskWatch,
      askNext:
        kind === 'ASK_NEXT' ? current.askNext.filter((item) => item.id !== id) : current.askNext,
      threads: kind === 'GAP' ? current.threads.filter((item) => item.id !== id) : current.threads,
    }));
    setNotice(
      `Example suggestion ${event === 'acted' ? 'marked reviewed' : 'dismissed'} in this browser only. Nothing was saved or audited.`,
    );
  }

  return (
    <div
      className={`mind-workspace-shell ${styles.preview}`}
      onClickCapture={keepPreviewLocal}
      onAuxClickCapture={keepPreviewLocal}
      onSubmitCapture={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setNotice('Form submissions are disabled in this preview.');
      }}
    >
      <div className={styles.banner}>
        <strong>Local design preview</strong>
        <span>Fictional examples · No microphone, database, AI calls or real saves</span>
      </div>
      <div className={styles.shell}>
        <Sidebar vertical="THERAPIST" usage={null} />
        <main className={`mind-content ${styles.content}`}>
          <div className={styles.controls}>
            <div className={styles.switches} role="group" aria-label="Preview screen">
              {(['Today', 'Guide', 'Live', 'Review'] as const).map((name) => (
                <button
                  key={name}
                  type="button"
                  aria-pressed={view === name}
                  onClick={() => setView(name)}
                >
                  {name}
                </button>
              ))}
            </div>
            <p role="status">{notice}</p>
          </div>

          {view === 'Today' && (
            <MindTodayWorkspace
              dateLabel="Saturday, September 5 · fictional day"
              hero={exampleSession}
              agenda={[
                {
                  session: {
                    ...exampleSession,
                    id: 'preview-session-b',
                    clientId: 'preview-client-b',
                    clientName: 'Example client B',
                    scheduledAt: '2026-09-05T04:30:00.000Z',
                    status: 'COMPLETED',
                    hasSignedNote: true,
                    draftStatus: 'COMPLETED',
                  },
                },
                {
                  session: {
                    ...exampleSession,
                    id: 'preview-session-c',
                    clientId: 'preview-client-c',
                    clientName: 'Example client C',
                    scheduledAt: '2026-09-05T06:00:00.000Z',
                    status: 'COMPLETED',
                    draftStatus: 'COMPLETED',
                  },
                },
                {
                  session: {
                    ...exampleSession,
                    id: 'preview-session-d',
                    clientId: 'preview-client-d',
                    clientName: 'Example client D',
                    scheduledAt: '2026-09-05T10:00:00.000Z',
                    kind: 'INTAKE',
                    modality: null,
                  },
                  dueMeasure: null,
                },
              ]}
              upcoming={[
                {
                  ...exampleSession,
                  id: 'preview-session-e',
                  clientName: 'Example client E',
                  scheduledAt: '2026-09-07T05:30:00.000Z',
                  kind: 'REVIEW',
                },
              ]}
              attentionItems={[
                {
                  id: 'preview-note-issue',
                  kind: 'NOTE_NEEDS_ATTENTION',
                  occurredAt: '2026-09-04T08:00:00.000Z',
                  title: 'Example client F',
                  detail:
                    'Example interrupted generation. The recording is ready to resume processing.',
                  href: '/app/sessions/preview-session-f?tab=note',
                  ctaLabel: 'Resume generation',
                },
                {
                  id: 'preview-note-review',
                  kind: 'NOTE_REVIEW',
                  occurredAt: '2026-09-05T06:45:00.000Z',
                  title: 'Example client C',
                  detail: 'The draft is ready for your review and next steps.',
                  href: '/app/sessions/preview-session-c?tab=note',
                  ctaLabel: 'Review & Close',
                },
                {
                  id: 'preview-response',
                  kind: 'CLIENT_RESPONSE',
                  occurredAt: '2026-09-05T07:00:00.000Z',
                  title: 'Example client B',
                  detail: 'Fictional between-session response received.',
                  href: '/app/clients/preview-client-b/shared',
                  ctaLabel: 'Review response',
                },
              ]}
              defaultCapture="LIVE"
              progress={{ completed: 2, signed: 1, ready: 1, remaining: 1 }}
              actions={
                <>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setView('Live');
                      setNotice('Showing a fictional session. No recording was started.');
                    }}
                  >
                    Walk-in
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      setNotice(
                        'Scheduling is disabled here. This preview has no database connection.',
                      )
                    }
                  >
                    Schedule session
                  </Button>
                </>
              }
              preparation={
                <div className={styles.brief}>
                  <h3>Carry the conversation forward</h3>
                  <p>
                    Last time, this fictional client wanted more space to understand changes in
                    their daily routine.
                  </p>
                  <dl>
                    <div>
                      <dt>Agreed focus</dt>
                      <dd>Revisit what felt useful since the last conversation.</dd>
                    </div>
                    <div>
                      <dt>A question to carry in</dt>
                      <dd>“What would you most like us to make time for today?”</dd>
                    </div>
                  </dl>
                  <p className={styles.exampleLabel}>
                    Fictional preparation brief · reviewed by you before use
                  </p>
                </div>
              }
            />
          )}

          {view === 'Guide' && (
            <Container className={styles.panel}>
              <MindSessionReviewHeader
                clientName="Example client A"
                sessionDate="5 Sep 2026"
                sessionKind="TREATMENT"
                status="SCHEDULED"
                isDemo
                spokenLanguageLabel="English"
              />
              <MindTherapyGuide script={script} />
            </Container>
          )}

          {view === 'Live' && (
            <Container className={styles.panel}>
              <header className="mind-live-header">
                <p className={styles.exampleLabel}>Fictional live session · microphone off</p>
                <h1 className="font-serif">Example client A</h1>
                <p className={styles.subtle}>
                  Your conversation stays at the centre. Suggestions wait for your judgment.
                </p>
              </header>
              <div className="mind-live-modes">
                <div className="mind-mode-picker" role="group" aria-label="Companion mode">
                  <button
                    type="button"
                    aria-pressed={mode === 'quiet'}
                    onClick={() => setMode('quiet')}
                  >
                    Quiet
                  </button>
                  <button
                    type="button"
                    aria-pressed={mode === 'guided'}
                    onClick={() => setMode('guided')}
                  >
                    Guided
                  </button>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setReasoning(initialReasoning);
                    setNotice('Fictional live suggestions reset. Nothing was saved.');
                  }}
                >
                  Reset examples
                </Button>
              </div>
              <div className={styles.liveGrid}>
                <Card className={styles.transcript}>
                  <h2>Conversation</h2>
                  <p className={styles.exampleLabel}>
                    Static fictional transcript, not a recording
                  </p>
                  <div>
                    <span>Example client</span>
                    <p>
                      Some days felt different this week. I would like to understand what was
                      different.
                    </p>
                  </div>
                  <div>
                    <span>Psychologist</span>
                    <p>Which moment would you like us to start with?</p>
                  </div>
                  <div>
                    <span>Example client</span>
                    <p>I also want to make space for an important concern today.</p>
                  </div>
                  <div className={styles.noMic}>Microphone off · no audio is captured</div>
                </Card>
                <TherapyCopilotRail reasoning={reasoning} onResolve={resolveExample} mode={mode} />
              </div>
              <details className="rounded-xl border border-line p-4">
                <summary className="cursor-pointer text-sm font-medium">
                  Preview status colours
                </summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <Card className="p-4" data-preview-status="neutral">
                    Neutral sample · fictional
                  </Card>
                  <Card className="border border-red-300 bg-red-50 p-4" data-preview-status="risk">
                    Red risk sample · fictional
                  </Card>
                  <Card
                    className="border border-amber-300 bg-amber-50 p-4"
                    data-preview-status="warning"
                  >
                    Amber warning sample · fictional
                  </Card>
                </div>
              </details>
            </Container>
          )}

          {view === 'Review' && (
            <Container className={styles.panel}>
              <MindSessionReviewHeader
                clientName="Example client C"
                sessionDate="5 Sep 2026, 11:30 am"
                sessionKind="TREATMENT"
                status="COMPLETED"
                isDemo
                spokenLanguageLabel="English"
              />
              <Card className={styles.review}>
                <h2>Your record, ready for review.</h2>
                <p>
                  This panel demonstrates the review layout with fictional text. The authenticated
                  signing and sharing components are deliberately not mounted here.
                </p>
                <div className={styles.reviewColumns}>
                  <section>
                    <h3>Draft session summary</h3>
                    <p>
                      The fictional conversation explored the client’s priorities and one recent
                      change in their routine. The psychologist invited corrections to their
                      understanding and discussed what to return to next time.
                    </p>
                    <p>
                      No diagnosis, completed intervention, client agreement or clinical improvement
                      is inferred by this preview.
                    </p>
                  </section>
                  <section>
                    <h3>Before you close</h3>
                    <ol>
                      <li>Check the draft against what was actually said.</li>
                      <li>Review any concern that needs attention.</li>
                      <li>Confirm only the next steps actually agreed.</li>
                    </ol>
                    <Button disabled>Signing unavailable in preview</Button>
                  </section>
                </div>
              </Card>
            </Container>
          )}
        </main>
      </div>
    </div>
  );
}
