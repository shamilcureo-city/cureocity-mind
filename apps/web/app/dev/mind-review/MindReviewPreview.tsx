'use client';

import { useState } from 'react';
import { TherapyNoteV1Schema, type MindSessionCloseout as Closeout } from '@cureocity/contracts';
import { Card } from '@/components/ui/Card';
import { MindCloseoutDecisionActions } from '@/components/app/MindCloseoutDecisionActions';
import { MindNoteRewrite } from '@/components/app/MindNoteRewrite';
import { MindSessionCloseout } from '@/components/app/MindSessionCloseout';
import { MindSessionPhaseRail } from '@/components/app/MindSessionPhaseRail';
import { MindSessionReviewHeader } from '@/components/app/MindSessionReviewHeader';
import { NotePreview } from '@/components/app/NotePreview';
import { NoteToolbar } from '@/components/app/NoteToolbar';
import { SessionWorkspaceTabs } from '@/components/app/SessionWorkspaceTabs';
import type { EditableMindNote } from '@/lib/mind-note-proposal';
import { useMindCloseoutTaskStatus } from '@/lib/mind-closeout-task-status';

type PreviewState = 'ready' | 'generating' | 'failed' | 'reopened' | 'signed';

const previewStates: Array<{ key: PreviewState; label: string }> = [
  { key: 'ready', label: 'Unsigned draft' },
  { key: 'generating', label: 'Generating' },
  { key: 'failed', label: 'Needs attention' },
  { key: 'reopened', label: 'Reopened' },
  { key: 'signed', label: 'Signed' },
];

const initial = TherapyNoteV1Schema.parse({
  version: 'V1',
  modality: 'SUPPORTIVE',
  summary:
    'Ananya described an interrupted week and noticed that uncertainty led her to withdraw from two planned conversations.',
  subjective:
    'The fictional client described feeling tense before difficult conversations and relieved after naming what she needed.',
  objective:
    'The fictional client remained engaged, reflected on alternatives and identified one practical experiment.',
  assessment:
    'The session explored avoidance, uncertainty and self-criticism. Further information is needed; no diagnosis is established by this example.',
  plan: '- Notice the first sign of withdrawal\n- Use the agreed grounding step\n- Review what helped at the next fictional visit',
  riskFlags: { severity: 'none', indicators: [] },
});
const base = '2026-09-14T10:00:00.000Z';

/** Closed fictional transport: cannot call fetch, a model or a clinical API. */
export function MindReviewPreview() {
  const [previewState, setPreviewState] = useState<PreviewState>('ready');
  const [draft, setDraft] = useState<{ content: EditableMindNote; updatedAt: string }>({
    content: initial,
    updatedAt: base,
  });
  const [lostReceipt, setLostReceipt] = useState(false);
  const [reset, setReset] = useState(0);
  const [busy, setBusy] = useState(false);
  const transport: typeof fetch = async (_url, init) => {
    const payload = JSON.parse(String(init?.body));
    if (init?.method === 'POST' && payload.mode === 'PREVIEW')
      return Response.json({
        applied: false,
        kind: 'TREATMENT',
        baseUpdatedAt: draft.updatedAt,
        note: { ...draft.content, plan: 'Return to the agreed focus next visit.' },
      });
    if (init?.method === 'PUT') {
      if (lostReceipt) throw new Error('Simulated lost save receipt; no real save occurred.');
      return Response.json({ note: payload.note, updatedAt: '2026-09-14T10:01:00.000Z' });
    }
    throw new Error('This fictional preview cannot make network requests.');
  };
  const closeout = closeoutFor(previewState);
  const noteReady =
    previewState === 'ready' || previewState === 'reopened' || previewState === 'signed';

  return (
    <main className="mind-workspace-shell min-h-screen bg-[var(--color-bg)] px-4 py-6 text-[var(--color-ink)] sm:px-8 sm:py-8">
      <div className="mx-auto max-w-7xl">
        <aside className="mb-5 rounded-xl border border-[var(--color-line-soft)] bg-white px-4 py-3 text-sm leading-6">
          <strong>Fictional local preview.</strong> No client records, microphone, paid AI calls,
          signing or sharing. Changes exist only in this page.
        </aside>

        <section aria-label="Preview controls" className="mb-5 space-y-3 print:hidden">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Clinical note state">
            {previewStates.map((state) => (
              <button
                key={state.key}
                type="button"
                aria-pressed={previewState === state.key}
                className="min-h-11 rounded-full border border-[var(--color-line)] bg-white px-4 text-sm aria-pressed:border-[var(--color-accent)] aria-pressed:bg-[var(--color-accent-soft)] aria-pressed:text-[var(--color-accent)]"
                onClick={() => setPreviewState(state.key)}
              >
                {state.label}
              </button>
            ))}
          </div>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={lostReceipt}
              disabled={busy}
              onChange={(event) => setLostReceipt(event.target.checked)}
            />
            Simulate an unconfirmed wording-save receipt
          </label>
        </section>

        <MindSessionPhaseRail active="review" />
        <MindSessionReviewHeader
          clientName="Ananya (fictional)"
          sessionDate="14 Sep 2026, 3:30 pm"
          sessionKind="TREATMENT"
          mindPurpose="COUNSELLING"
          status="COMPLETED"
          isDemo
          spokenLanguageLabel="English"
        />
        <SessionWorkspaceTabs
          sessionId="fictional-review"
          active="note"
          canReviewClinical={false}
          hrefBase="/dev/mind-review"
        />

        <div className="mt-6">
          <MindSessionCloseout
            sessionId="fictional-review"
            closeout={closeout}
            client={{ id: 'fictional-client', fullName: 'Ananya', preferredModality: null }}
            sessionAt={new Date(base)}
            sessionCompleted
            canShare={false}
            canReviewClinical={false}
            canRecordWork={false}
            agreementCount={1}
            selectedQuestionCount={1}
            receipts={[]}
            hasSignedNote={previewState === 'reopened' || previewState === 'signed'}
            decisionActions={
              <MindCloseoutDecisionActions
                sessionId="fictional-review"
                steps={closeout.steps}
                canShare={false}
                canReviewClinical={false}
                canRecordWork={false}
                agreementCount={1}
                agreements={<FictionalAgreement />}
                appointment={<p>No appointment is created in this preview.</p>}
              />
            }
          >
            <Card className="p-5 sm:p-7">
              {noteReady ? (
                <>
                  <NoteToolbar
                    sessionId="fictional-review"
                    clientName="Ananya"
                    noteText={noteToText(draft.content)}
                    signed={previewState === 'signed'}
                    showClinicalReview={false}
                    pdfHref={null}
                    leftControls={
                      <>
                        <span className="rounded-full border border-[var(--color-line)] bg-white px-3 py-2 text-xs">
                          BASE note
                        </span>
                        <span className="rounded-full border border-[var(--color-line)] bg-white px-3 py-2 text-xs">
                          Detailed
                        </span>
                      </>
                    }
                  />
                  {'plan' in draft.content && (
                    <NotePreview
                      note={draft.content}
                      signedAt={previewState === 'signed' ? base : null}
                      signedBy={previewState === 'signed' ? 'Fictional psychologist' : null}
                    />
                  )}
                  {previewState !== 'signed' && (
                    <div className="mt-7 border-t border-[var(--color-line-soft)] pt-5">
                      <MindNoteRewrite
                        key={reset}
                        sessionId="fictional-review"
                        currentDraft={draft}
                        transport={transport}
                        onBusyChange={setBusy}
                        onModified={(content, updatedAt) => setDraft({ content, updatedAt })}
                      />
                      <div className="mt-5 flex flex-wrap gap-3">
                        <button
                          type="button"
                          className="min-h-11 rounded-full bg-[var(--color-accent)] px-5 font-semibold text-white"
                          onClick={() => setPreviewState('signed')}
                        >
                          {previewState === 'reopened' ? 'Sign & re-lock' : 'Sign this note'}
                        </button>
                        <button
                          type="button"
                          className="min-h-11 rounded-full border border-[var(--color-line)] bg-white px-5"
                          onClick={() => {
                            setReset((value) => value + 1);
                            setBusy(false);
                            setDraft({ content: initial, updatedAt: base });
                          }}
                        >
                          Reset fictional note
                        </button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <NoteStatePanel state={previewState} onShowReady={() => setPreviewState('ready')} />
              )}
            </Card>
          </MindSessionCloseout>
        </div>
      </div>
    </main>
  );
}

function closeoutFor(state: PreviewState): Closeout {
  const signed = state === 'signed';
  const noteReady = state === 'ready' || state === 'reopened' || signed;
  return {
    product: 'MIND',
    status:
      state === 'generating'
        ? 'GENERATING'
        : state === 'failed'
          ? 'NEEDS_ATTENTION'
          : 'REVIEW_AND_CLOSE',
    steps: {
      noteGenerated: noteReady ? 'COMPLETE' : 'PENDING',
      noteReviewed: signed ? 'COMPLETE' : 'PENDING',
      clinicalSuggestions: 'PENDING',
      agreements: 'COMPLETE',
      nextSessionQuestions: 'COMPLETE',
      followUp: 'PENDING',
      signed: signed ? 'COMPLETE' : 'PENDING',
      shared: 'PENDING',
    },
  };
}

function NoteStatePanel({ state, onShowReady }: { state: PreviewState; onShowReady: () => void }) {
  const failed = state === 'failed';
  return (
    <section className="min-h-72 content-center text-center" aria-live="polite">
      <h2 className="font-serif text-2xl">
        {failed ? 'The note needs attention' : 'Preparing the clinical note'}
      </h2>
      <p className="mx-auto mt-3 max-w-lg leading-7 text-[var(--color-ink-2)]">
        {failed
          ? 'The fictional generation did not finish. In production, the original session material remains available for retry or manual documentation.'
          : 'The fictional session material is being organised. Signing is unavailable until a complete draft is ready.'}
      </p>
      <button
        type="button"
        className="mt-5 min-h-11 rounded-full border border-[var(--color-line)] bg-white px-5"
        onClick={onShowReady}
      >
        Show a ready fictional draft
      </button>
    </section>
  );
}

function noteToText(note: EditableMindNote): string {
  if ('plan' in note) {
    return [note.summary, note.subjective, note.objective, note.assessment, note.plan]
      .filter(Boolean)
      .join('\n\n');
  }
  return JSON.stringify(note);
}

function FictionalAgreement() {
  const savedAgreement = 'Notice withdrawal and use the agreed grounding step.';
  const [text, setText] = useState(savedAgreement);
  const [error, setError] = useState(false);
  useMindCloseoutTaskStatus({
    dirty: text !== savedAgreement,
    busy: false,
    needsAttention: error,
  });
  return (
    <div className="space-y-3">
      <label className="block space-y-2">
        Fictional agreement
        <textarea
          className="block w-full rounded-xl border p-3"
          rows={3}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Type a fictional agreement to test switching tasks"
        />
      </label>
      <button
        type="button"
        className="min-h-11 rounded-xl border px-4 text-sm"
        onClick={() => setError(true)}
      >
        Simulate an agreement save error
      </button>
      {error && <p role="alert">Fictional save error. No record was created.</p>}
    </div>
  );
}
