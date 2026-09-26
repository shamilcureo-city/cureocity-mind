'use client';

import { useState } from 'react';
import { MedicalEncounterNoteV1Schema, DifferentialDiagnosisV1Schema } from '@cureocity/contracts';
import { ScribeTransportProvider } from '@/components/app/ScribeTransport';
import { ScribeCodingPanel } from '@/components/app/ScribeCodingPanel';
import { Button } from '@/components/ui/Button';
import { useScribeCoding, scribeCodingNoteHash } from '@/lib/use-scribe-coding';
import {
  ScribeCodingSaveSchema,
  scribeCodingSuggestions,
  type ScribeCodingResponse,
} from '@/lib/scribe-coding';

const baseline = MedicalEncounterNoteV1Schema.parse({
  version: 'V1',
  encounterKind: 'FOLLOW_UP',
  chiefComplaint: 'Tiredness for two weeks.',
  hpi: 'Fictional patient reports improved sleep but persistent afternoon tiredness.',
  assessment: 'Fictional demonstration: fatigue reported; no underlying diagnosis confirmed.',
  plan: 'Review the history and previous reports with the patient.',
  linkedEvidence: [{ field: 'assessment', quote: 'I still feel tired in the afternoon.' }],
});
const suggestions = scribeCodingSuggestions(
  DifferentialDiagnosisV1Schema.parse({
    version: 'V1',
    candidates: [{ condition: 'Malaise and fatigue', icd10Code: 'R53' }],
  }),
);

/** Memory-only imitation of the response contract. Never calls a clinical API or saves a record. */
function createFixture() {
  let record: ScribeCodingResponse['record'] = null;
  let signedNoteHash: string | null = null;
  let failNextSave = false;
  const snapshot = async (): Promise<ScribeCodingResponse> => {
    const hash = await scribeCodingNoteHash(baseline);
    return {
      draft: { id: 'fictional-draft', hash, content: baseline },
      signed: signedNoteHash !== null,
      signedNoteHash,
      record,
      sourceCurrent:
        record === null
          ? null
          : record.body.draftHash === hash &&
            (signedNoteHash === null || record.body.reviewedNoteHash === signedNoteHash),
      suggestions,
    };
  };
  const fetcher: typeof fetch = async (input, init) => {
    if (String(input) !== '/api/v1/scribe/encounters/fictional-visit/coding')
      return Response.json(
        { error: 'This fictional preview does not call clinical services.' },
        { status: 404 },
      );
    if (init?.method === 'PUT') {
      if (failNextSave) {
        failNextSave = false;
        return Response.json(
          { error: 'Simulated save failure. Your edits have not been confirmed.' },
          { status: 503 },
        );
      }
      if (signedNoteHash)
        return Response.json({ error: 'This fictional encounter is read-only.' }, { status: 409 });
      const parsed = ScribeCodingSaveSchema.safeParse(JSON.parse(String(init.body)));
      if (!parsed.success)
        return Response.json({ error: 'Review the worksheet fields.' }, { status: 400 });
      if (parsed.data.expectedRevision !== (record?.revision ?? 0))
        return Response.json(
          { error: 'The worksheet changed. Reload before saving.' },
          { status: 409 },
        );
      const now = new Date().toISOString();
      const reviewed = parsed.data.worksheet.status === 'reviewed';
      record = {
        id: 'fictional-coding',
        revision: (record?.revision ?? 0) + 1,
        clientId: 'fictional-patient',
        sessionId: 'fictional-visit',
        createdAt: record?.createdAt ?? now,
        updatedAt: now,
        body: {
          worksheet: parsed.data.worksheet,
          draftId: 'fictional-draft',
          draftHash: parsed.data.draftHash,
          reviewedNoteHash: reviewed ? await scribeCodingNoteHash(parsed.data.workingNote) : null,
          reviewedAt: reviewed ? now : null,
          reviewedBy: reviewed ? 'fictional-doctor' : null,
        },
      };
    }
    return Response.json(await snapshot());
  };
  return {
    fetcher,
    failNextSave: () => {
      failNextSave = true;
    },
    freeze: async (note: typeof baseline) => {
      signedNoteHash = await scribeCodingNoteHash(note);
    },
  };
}

export function ScribeCodingPreview() {
  const [fixture] = useState(createFixture);
  return (
    <ScribeTransportProvider fetcher={fixture.fetcher}>
      <Preview fixture={fixture} />
    </ScribeTransportProvider>
  );
}

function Preview({ fixture }: { fixture: ReturnType<typeof createFixture> }) {
  const [note, setNote] = useState(baseline);
  const [signed, setSigned] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [workPending, setWorkPending] = useState(false);
  const [scenario, setScenario] = useState('');
  const coding = useScribeCoding({
    sessionId: 'fictional-visit',
    note,
    baseline,
    enabled: true,
    signed,
  });
  return (
    <main className="mx-auto max-w-[1320px] px-4 py-6 sm:px-8">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl">Review diagnosis coding</h1>
          <p className="mt-2 text-sm text-[var(--color-ink-2)]">Ananya Rao · fictional follow-up</p>
        </div>
        <p className="text-sm text-[var(--color-ink-2)]">Cureocity Scribe · local preview</p>
      </header>
      <p
        role="status"
        className="mb-5 rounded-xl border border-[var(--color-line)] bg-white p-4 text-sm leading-6"
      >
        Fictional data only. “Save” simulates the real workflow in this page's memory; reloading
        clears it. No patient record, clinical signature, AI call or insurance claim is created.
      </p>
      <div className="mb-5 flex flex-wrap gap-2" aria-label="Coding preview scenarios">
        <Button
          variant="secondary"
          disabled={signed}
          onClick={() => {
            fixture.failNextSave();
            setScenario('The next save will fail so you can check recovery.');
          }}
        >
          Simulate next save failure
        </Button>
        <Button
          variant="secondary"
          disabled={signed || workPending || coding.saving}
          onClick={() => {
            setNote({
              ...note,
              assessment: `${baseline.assessment} The doctor has added new context.`,
            });
            setScenario('The note changed; any earlier coding review now needs another review.');
          }}
        >
          Change note after review
        </Button>
        <Button
          variant="secondary"
          disabled={signed || workPending || coding.saving}
          onClick={() =>
            void (async () => {
              await fixture.freeze(note);
              setSigned(true);
              setScenario('Read-only signed-encounter scenario. No actual signature was created.');
            })()
          }
        >
          Show signed encounter
        </Button>
      </div>
      {scenario && (
        <p role="status" className="mb-4 text-sm">
          {scenario}
        </p>
      )}
      {sourceOpen && (
        <section
          aria-label="Fictional source"
          className="mb-5 rounded-xl border border-[var(--color-line)] bg-white p-5"
        >
          <h2 className="font-serif text-xl">Saved conversation excerpt</h2>
          <p className="my-3 text-sm leading-6">
            Patient: I sleep seven hours most nights. I still feel tired in the afternoon.
          </p>
          <p className="mb-3 text-sm text-[var(--color-ink-2)]">
            A quote is not confirmation of a diagnosis or code.
          </p>
          <Button variant="secondary" onClick={() => setSourceOpen(false)}>
            Close source
          </Button>
        </section>
      )}
      <section className="rounded-2xl border border-[var(--color-line)] bg-white p-4 sm:p-6">
        <ScribeCodingPanel
          note={note}
          state={coding.state}
          currentNoteHash={
            coding.state?.signed ? coding.state.signedNoteHash : coding.currentNoteHash
          }
          loading={coding.loading}
          saving={coding.saving}
          error={coding.error}
          signed={signed}
          onSave={async (worksheet) => {
            const saved = await coding.save(worksheet);
            if (saved) setScenario('');
            return saved;
          }}
          onReload={() => void coding.reload()}
          onReviewSource={() => setSourceOpen(true)}
          onWorkChange={setWorkPending}
        />
      </section>
    </main>
  );
}
