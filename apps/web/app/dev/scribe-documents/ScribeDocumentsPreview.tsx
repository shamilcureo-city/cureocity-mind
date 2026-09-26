'use client';

import { useState } from 'react';
import { ScribeTransportProvider } from '@/components/app/ScribeTransport';
import { ScribeConsultationDocumentsPanel } from '@/components/app/ScribeConsultationDocumentsPanel';
import { useScribeConsultationDocuments } from '@/lib/use-scribe-consultation-documents';
import {
  ScribeConsultationDocumentsCreateSchema,
  ScribeConsultationDocumentUpdateSchema,
  SCRIBE_CONSULTATION_DOCUMENT_LABELS,
  type ScribeConsultationDocumentsResponse,
  type ScribeConsultationDocument,
} from '@/lib/scribe-consultation-documents';
import { Button } from '@/components/ui/Button';
import { hasUnresolvedScribeTemplateFields } from '@/lib/scribe-doctor-templates';

/** Fictional memory-only transport; never calls an API or persists patient data. */
export function createScribeDocumentsPreviewFixture() {
  let source: ScribeConsultationDocumentsResponse['source'] = {
    state: 'ready',
    hash: 'a'.repeat(64),
    noteId: 'fictional-note',
    signedAt: '2026-09-26T09:00:00.000Z',
  };
  let packets: ScribeConsultationDocumentsResponse['packets'] = [];
  let failNextSave = false;
  const snapshot = (): ScribeConsultationDocumentsResponse => ({
    source,
    packets: packets.map((packet) => ({
      ...packet,
      sourceCurrent:
        source.state === 'ready' &&
        source.hash === packet.body.sourceHash &&
        source.noteId === packet.body.noteId &&
        source.signedAt === packet.body.signedAt,
    })),
  });
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url === '/api/v1/scribe/templates' && (!init?.method || init.method === 'GET'))
      return Response.json({ records: [] });
    if (init?.method === 'POST' || init?.method === 'PATCH') {
      if (failNextSave) {
        failNextSave = false;
        return Response.json(
          { error: 'Simulated save failure. Your changes have not been confirmed.' },
          { status: 503 },
        );
      }
      if (source.state !== 'ready')
        return Response.json(
          { error: 'Sign and lock the note before preparing documents.' },
          { status: 409 },
        );
    }
    if (url === '/api/v1/scribe/encounters/fictional-visit/documents') {
      if (init?.method === 'POST') {
        const parsed = ScribeConsultationDocumentsCreateSchema.safeParse(
          JSON.parse(String(init.body)),
        );
        if (!parsed.success)
          return Response.json({ error: 'Choose valid document types.' }, { status: 400 });
        if (parsed.data.expectedSourceHash !== source.hash)
          return Response.json(
            { error: 'The source changed. Reload before preparing new drafts.' },
            { status: 409 },
          );
        if (!packets.some((packet) => packet.body.operationId === parsed.data.operationId)) {
          if (packets.length >= 10)
            return Response.json(
              { error: 'This encounter has reached its draft-packet limit.' },
              { status: 409 },
            );
          const now = new Date().toISOString();
          packets = [
            {
              id: `fictional-packet-${packets.length + 1}`,
              revision: 1,
              clientId: 'fictional-patient',
              sessionId: 'fictional-visit',
              createdAt: now,
              updatedAt: now,
              sourceCurrent: true,
              body: {
                version: 1,
                operationId: parsed.data.operationId,
                requestHash: 'c'.repeat(64),
                sourceHash: source.hash!,
                noteId: source.noteId!,
                signedAt: source.signedAt!,
                documents: parsed.data.types.map(
                  (type): ScribeConsultationDocument => ({
                    id: type,
                    type,
                    additions: '',
                    status: 'draft',
                    reviewedAt: null,
                    reviewedBy: null,
                    sourceSections:
                      type === 'medical_certificate'
                        ? []
                        : [
                            {
                              label: 'Presenting concern — signed note',
                              text: 'Fictional patient reports tiredness for two weeks.',
                            },
                            {
                              label: 'Assessment — signed note',
                              text: 'Tiredness reported; no underlying diagnosis confirmed in this fictional consultation.',
                            },
                            {
                              label: 'Plan — signed note',
                              text: 'Review the history and previous reports with the patient.',
                            },
                          ],
                  }),
                ),
              },
            },
            ...packets,
          ];
        }
      }
      return Response.json(snapshot());
    }
    const edit = url.match(/^\/api\/v1\/scribe\/documents\/([a-zA-Z0-9_-]+)$/);
    if (edit && init?.method === 'PATCH') {
      const packet = packets.find((value) => value.id === edit[1]);
      const parsed = ScribeConsultationDocumentUpdateSchema.safeParse(
        JSON.parse(String(init.body)),
      );
      if (!packet || !parsed.success)
        return Response.json({ error: 'Document not found.' }, { status: 404 });
      if (parsed.data.reviewed && hasUnresolvedScribeTemplateFields(parsed.data.additions))
        return Response.json(
          { error: 'Complete or remove unfinished template fields before review.' },
          { status: 409 },
        );
      if (packet.revision !== parsed.data.revision || packet.body.sourceHash !== source.hash)
        return Response.json(
          { error: 'This draft or its signed source changed. Reload before continuing.' },
          { status: 409 },
        );
      const now = new Date().toISOString();
      packets = packets.map((value) =>
        value.id !== packet.id
          ? value
          : {
              ...value,
              revision: value.revision + 1,
              updatedAt: now,
              body: {
                ...value.body,
                documents: value.body.documents.map((doc) =>
                  doc.id !== parsed.data.documentId
                    ? doc
                    : {
                        ...doc,
                        additions: parsed.data.additions,
                        status: parsed.data.reviewed ? 'reviewed' : 'draft',
                        reviewedAt: parsed.data.reviewed ? now : null,
                        reviewedBy: parsed.data.reviewed ? 'fictional-doctor' : null,
                      },
                ),
              },
            },
      );
      return Response.json(snapshot());
    }
    const download = url.match(
      /^\/api\/v1\/scribe\/documents\/([a-zA-Z0-9_-]+)\/(referral|patient_summary|medical_certificate)\/text\?revision=(\d+)$/,
    );
    if (download) {
      const packet = packets.find((value) => value.id === download[1]);
      const document = packet?.body.documents.find((value) => value.id === download[2]);
      if (
        !packet ||
        !document ||
        document.status !== 'reviewed' ||
        hasUnresolvedScribeTemplateFields(document.additions) ||
        source.state !== 'ready' ||
        packet.body.sourceHash !== source.hash ||
        packet.revision !== Number(download[3])
      )
        return Response.json({ error: 'Review a current draft before download.' }, { status: 409 });
      return new Response(
        [
          'FICTIONAL PREVIEW — DRAFT — NOT ISSUED',
          SCRIBE_CONSULTATION_DOCUMENT_LABELS[document.type],
          ...(document.type === 'medical_certificate'
            ? ['NOT VALID FOR ISSUE. No certificate has been signed or issued.']
            : []),
          ...document.sourceSections.map((section) => `${section.label}\n${section.text}`),
          `Doctor additions\n${document.additions || 'Not entered.'}`,
        ].join('\n\n'),
        {
          headers: {
            'content-type': 'text/plain; charset=utf-8',
            'content-disposition': 'attachment; filename="fictional-DRAFT.txt"',
            'cache-control': 'private, no-store',
          },
        },
      );
    }
    return Response.json(
      { error: 'This fictional preview does not call clinical services.' },
      { status: 404 },
    );
  };
  return {
    fetcher,
    failNextSave: () => {
      failNextSave = true;
    },
    changeSource: () => {
      source = {
        ...source,
        state: 'ready',
        hash: crypto.randomUUID().replaceAll('-', '').padEnd(64, '0'),
        signedAt: new Date().toISOString(),
      };
    },
    unlock: () => {
      source = { ...source, state: 'unsigned', hash: null };
    },
  };
}

export function ScribeDocumentsPreview() {
  const [fixture] = useState(createScribeDocumentsPreviewFixture);
  return (
    <ScribeTransportProvider fetcher={fixture.fetcher}>
      <Preview fixture={fixture} />
    </ScribeTransportProvider>
  );
}

function Preview({ fixture }: { fixture: ReturnType<typeof createScribeDocumentsPreviewFixture> }) {
  const documents = useScribeConsultationDocuments({
    clientId: 'fictional-patient',
    sessionId: 'fictional-visit',
    enabled: true,
  });
  const [workPending, setWorkPending] = useState(false);
  const [scenario, setScenario] = useState('');
  return (
    <main className="mx-auto max-w-[1200px] px-4 py-6 sm:px-8">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl">One consultation, several drafts</h1>
          <p className="mt-2 text-sm text-[var(--color-ink-2)]">Ananya Rao · fictional follow-up</p>
        </div>
        <p className="text-sm text-[var(--color-ink-2)]">Cureocity Scribe · local preview</p>
      </header>
      <p
        role="status"
        className="mb-5 rounded-xl border border-[var(--color-line)] bg-white p-4 text-sm leading-6"
      >
        Fictional data only. Saves stay in this page's memory and disappear on reload. No patient
        record, AI call, signature, issued certificate or message is created. Downloaded files are
        fictional drafts.
      </p>
      <div className="mb-4 flex flex-wrap gap-2" aria-label="Document preview scenarios">
        <Button
          variant="secondary"
          disabled={documents.busy}
          onClick={() => {
            fixture.failNextSave();
            setScenario('The next save will fail so you can check recovery.');
          }}
        >
          Simulate next save failure
        </Button>
        <Button
          variant="secondary"
          disabled={workPending || documents.busy}
          onClick={() => {
            fixture.changeSource();
            void documents.reload();
            setScenario('The signed source changed. Older documents are now out of date.');
          }}
        >
          Change signed source
        </Button>
        <Button
          variant="secondary"
          disabled={workPending || documents.busy}
          onClick={() => {
            fixture.unlock();
            void documents.reload();
            setScenario(
              'The source note is unlocked. Existing drafts cannot be reviewed or downloaded.',
            );
          }}
        >
          Show unsigned source
        </Button>
      </div>
      {scenario && (
        <p role="status" className="mb-4 text-sm">
          {scenario}
        </p>
      )}
      <ScribeConsultationDocumentsPanel
        state={documents.state}
        loading={documents.loading}
        busy={documents.busy}
        error={documents.error}
        onReload={() => void documents.reload()}
        onCreate={documents.create}
        onSave={documents.save}
        onDownload={documents.download}
        onWorkChange={setWorkPending}
      />
    </main>
  );
}
