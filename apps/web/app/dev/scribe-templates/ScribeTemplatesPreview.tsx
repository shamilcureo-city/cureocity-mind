'use client';

import { useState } from 'react';
import { MedicalEncounterNoteV1Schema } from '@cureocity/contracts';
import { ScribeTransportProvider } from '@/components/app/ScribeTransport';
import { ScribeDoctorTemplatesPanel } from '@/components/app/ScribeDoctorTemplatesPanel';
import { ScribeNoteStyleSettings } from '@/components/app/ScribeNoteStyleSettings';
import { MedicalNoteView } from '@/components/app/MedicalNoteView';
import { ScribeConsultationDocumentsWorkspace } from '@/components/app/ScribeConsultationDocumentsWorkspace';
import { useScribeDoctorTemplates } from '@/lib/use-scribe-doctor-templates';
import { useScribeNoteStyle } from '@/lib/use-scribe-personalization';
import { createScribeTemplatePreviewFixture } from './template-preview-fixture';

const fictionalNote = MedicalEncounterNoteV1Schema.parse({
  version: 'V1',
  encounterKind: 'FOLLOW_UP',
  chiefComplaint: 'Fictional follow-up concern.',
  hpi: 'This sample text must remain unchanged when a presentation template is applied.',
  assessment: 'Fictional example only; no diagnosis is asserted.',
  plan: 'Review the documented concerns with the patient.',
  linkedEvidence: [{ field: 'hpi', quote: 'This is fictional evidence for the preview.' }],
});

export function ScribeTemplatesPreview() {
  const [fixture] = useState(createScribeTemplatePreviewFixture);
  return (
    <ScribeTransportProvider fetcher={fixture.fetcher}>
      <Preview fixture={fixture} />
    </ScribeTransportProvider>
  );
}

function Preview({ fixture }: { fixture: ReturnType<typeof createScribeTemplatePreviewFixture> }) {
  const templates = useScribeDoctorTemplates(true);
  const style = useScribeNoteStyle();
  const [section, setSection] = useState<'library' | 'note' | 'documents'>('library');
  const [notice, setNotice] = useState('');
  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <header className="mb-5">
        <h1 className="font-serif text-3xl">Templates for your practice</h1>
        <p className="mt-2 text-sm text-[var(--color-ink-2)]">
          Cureocity Scribe · fictional local preview
        </p>
      </header>
      <p className="mb-4 rounded-xl border border-[var(--color-line)] bg-white p-4 text-sm leading-6">
        Saves stay in this page's memory and disappear on reload. No patient record, clinical API,
        signature or issued document is created. Templates contain presentation settings or blank
        fields only.
      </p>
      <div className="mb-4 flex flex-wrap gap-2" aria-label="Template preview sections">
        {(['library', 'note', 'documents'] as const).map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={section === key}
            onClick={() => setSection(key)}
            className="min-h-11 rounded-lg border border-[var(--color-line)] bg-white px-4 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {
              {
                library: 'Template library',
                note: 'Try note presentation',
                documents: 'Try document templates',
              }[key]
            }
          </button>
        ))}
        <button
          type="button"
          disabled={templates.busy || style.busy}
          onClick={() => {
            fixture.failNextSave();
            setNotice('Failure simulation selected: try a template or style save, then retry it.');
          }}
          className="min-h-11 rounded-lg border border-[var(--color-line)] px-4 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Simulate next save failure
        </button>
      </div>
      {notice && (
        <p role="status" className="mb-4 text-sm">
          {notice}
        </p>
      )}
      <div hidden={section !== 'library'}>
        <ScribeDoctorTemplatesPanel settings={templates} />
      </div>
      <div hidden={section !== 'note'} className="space-y-4">
        <p className="text-sm">
          Choose a layout inside “My note style”, preview it, then explicitly save it. Only
          headings, order and spacing change.
        </p>
        <ScribeNoteStyleSettings settings={style} followUp />
        <section
          aria-label="Fictional note presentation"
          className="rounded-xl border border-[var(--color-line)] bg-white p-5"
        >
          <MedicalNoteView note={fictionalNote} />
        </section>
      </div>
      <div hidden={section !== 'documents'}>
        <ScribeConsultationDocumentsWorkspace
          clientId="fictional-patient"
          sessionId="fictional-visit"
        />
      </div>
    </main>
  );
}
