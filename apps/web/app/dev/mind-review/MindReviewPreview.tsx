'use client';

import { useState } from 'react';
import { TherapyNoteV1Schema } from '@cureocity/contracts';
import { MindNoteRewrite } from '@/components/app/MindNoteRewrite';
import { MindCloseoutDecisionActions } from '@/components/app/MindCloseoutDecisionActions';
import type { EditableMindNote } from '@/lib/mind-note-proposal';
import { useMindCloseoutTaskStatus } from '@/lib/mind-closeout-task-status';

const initial = TherapyNoteV1Schema.parse({
  version: 'V1',
  modality: 'SUPPORTIVE',
  subjective: 'Fictional client described an interrupted week.',
  objective: 'Fictional observation for interface testing only.',
  assessment: 'Further information is needed. No diagnosis is established by this example.',
  plan: 'At the next visit, return to the focus agreed during this fictional conversation.',
  riskFlags: { severity: 'none', indicators: [] },
});
const base = '2026-09-14T10:00:00.000Z';

/** Closed fictional transport: cannot call fetch, a model or a clinical API. */
export function MindReviewPreview() {
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
  return (
    <main className="mind-workspace-shell min-h-screen bg-[var(--color-bg)] p-5 text-[var(--color-ink)] sm:p-10">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="space-y-3">
          <p className="text-sm">Mind · fictional local preview</p>
          <h1 className="font-serif text-4xl">Review &amp; finish</h1>
          <p>
            No client records, microphone or paid AI calls. Changes below exist only in this page.
          </p>
        </header>
        <section
          aria-label="Preview controls"
          className="flex flex-wrap items-center gap-4 text-sm"
        >
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              checked={lostReceipt}
              disabled={busy}
              onChange={(event) => setLostReceipt(event.target.checked)}
            />
            Simulate an unconfirmed save
          </label>
          <button
            type="button"
            className="min-h-11 rounded-xl border px-4"
            onClick={() => {
              setReset((value) => value + 1);
              setBusy(false);
              setDraft({ content: initial, updatedAt: base });
            }}
          >
            Reset fictional review
          </button>
        </section>
        <section className="space-y-5 rounded-2xl bg-white p-5 sm:p-7" aria-label="Fictional note">
          <h2 className="font-serif text-2xl">Example client · unsigned draft</h2>
          <p className="max-w-prose leading-7">
            {'plan' in draft.content ? draft.content.plan : draft.content.immediatePlan}
          </p>
          <MindNoteRewrite
            key={reset}
            sessionId="fictional-review"
            currentDraft={draft}
            transport={transport}
            onBusyChange={setBusy}
            onModified={(content, updatedAt) => setDraft({ content, updatedAt })}
          />
        </section>
        <section
          className="space-y-3 rounded-2xl bg-white p-5 sm:p-7"
          aria-label="Fictional next steps"
        >
          <h2 className="font-serif text-2xl">Next steps, if useful</h2>
          <p className="text-sm">
            The forms here are local-only examples. Switch tasks to check that typed text stays
            available.
          </p>
          <MindCloseoutDecisionActions
            sessionId="fictional-review"
            steps={{
              noteGenerated: 'COMPLETE',
              noteReviewed: 'PENDING',
              clinicalSuggestions: 'PENDING',
              agreements: 'PENDING',
              nextSessionQuestions: 'PENDING',
              followUp: 'PENDING',
              signed: 'PENDING',
              shared: 'PENDING',
            }}
            canShare={false}
            canReviewClinical={false}
            canRecordWork={false}
            agreements={<FictionalAgreement />}
            appointment={<p>No appointment is created in this preview.</p>}
          />
        </section>
      </div>
    </main>
  );
}

function FictionalAgreement() {
  const [text, setText] = useState('');
  const [error, setError] = useState(false);
  useMindCloseoutTaskStatus({ dirty: text.length > 0, busy: false, needsAttention: error });
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
