import {
  ScribeDoctorTemplateCreateSchema,
  ScribeDoctorTemplateUpdateSchema,
  ScribeDoctorTemplateDeleteSchema,
  type ScribeDoctorTemplateRecord,
} from '@/lib/scribe-doctor-templates';
import { scribeDoctorTemplateHash } from '@/lib/use-scribe-doctor-templates';
import {
  ScribeNoteStyleUpdateSchema,
  type ScribeNoteStyle,
} from '@/lib/scribe-personalization-contracts';
import { createScribeDocumentsPreviewFixture } from '../scribe-documents/ScribeDocumentsPreview';

/** Page-memory only. Unknown destinations never fall back to real fetch. */
export function createScribeTemplatePreviewFixture() {
  let records: ScribeDoctorTemplateRecord[] = [];
  const deletedOperations = new Set<string>();
  let style: {
    id: string;
    revision: number;
    body: ScribeNoteStyle;
    createdAt: string;
    updatedAt: string;
  } | null = null;
  let failNextSave = false;
  const documents = createScribeDocumentsPreviewFixture();
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const templateRoute = /^\/api\/v1\/scribe\/templates(?:\/([a-zA-Z0-9_-]+))?$/.exec(url);
    if (templateRoute || url === '/api/v1/scribe/note-styles') {
      if (method !== 'GET' && failNextSave) {
        failNextSave = false;
        return Response.json(
          { error: 'Simulated save failure. Your edits are not confirmed.' },
          { status: 503 },
        );
      }
      if (templateRoute) {
        if (method === 'GET' && !templateRoute[1]) return Response.json({ records });
        if (method === 'POST' && !templateRoute[1]) {
          const parsed = ScribeDoctorTemplateCreateSchema.safeParse(JSON.parse(String(init?.body)));
          if (!parsed.success)
            return Response.json({ error: 'Check the private template fields.' }, { status: 400 });
          const createHash = await scribeDoctorTemplateHash(parsed.data.template);
          const found = records.find(
            (record) => record.body.operationId === parsed.data.operationId,
          );
          if (found)
            return found.body.createHash === createHash
              ? Response.json({ record: found })
              : Response.json({ error: 'The create request changed.' }, { status: 409 });
          if (deletedOperations.has(parsed.data.operationId))
            return Response.json(
              { error: 'This template was deleted. Reload before creating a new template.' },
              { status: 409 },
            );
          if (records.length >= 50)
            return Response.json({ error: 'The template library is full.' }, { status: 409 });
          const now = new Date().toISOString();
          const record: ScribeDoctorTemplateRecord = {
            id: `fictional-template-${parsed.data.operationId}`,
            revision: 1,
            clientId: null,
            sessionId: null,
            createdAt: now,
            updatedAt: now,
            body: {
              version: 1,
              operationId: parsed.data.operationId,
              createHash,
              template: parsed.data.template,
            },
          };
          records = [record, ...records];
          return Response.json({ record }, { status: 201 });
        }
        const existing = records.find((record) => record.id === templateRoute[1]);
        if (method === 'PATCH' && existing) {
          const parsed = ScribeDoctorTemplateUpdateSchema.safeParse(JSON.parse(String(init?.body)));
          if (!parsed.success)
            return Response.json({ error: 'Check your template.' }, { status: 400 });
          if (existing.revision !== parsed.data.revision)
            return Response.json(
              { error: 'The template changed. Reload before saving.' },
              { status: 409 },
            );
          const record = {
            ...existing,
            revision: existing.revision + 1,
            updatedAt: new Date().toISOString(),
            body: { ...existing.body, template: parsed.data.template },
          };
          records = records.map((value) => (value.id === record.id ? record : value));
          return Response.json({ record });
        }
        if (method === 'DELETE' && existing) {
          const parsed = ScribeDoctorTemplateDeleteSchema.safeParse(JSON.parse(String(init?.body)));
          if (!parsed.success || existing.revision !== parsed.data.revision)
            return Response.json(
              { error: 'Reload the saved template before deleting.' },
              { status: 409 },
            );
          deletedOperations.add(existing.body.operationId);
          records = records.filter((value) => value.id !== existing.id);
          return Response.json({ deletedId: existing.id, revision: existing.revision });
        }
      } else {
        if (method === 'GET') return Response.json({ record: style });
        if (method === 'PUT') {
          const parsed = ScribeNoteStyleUpdateSchema.safeParse(JSON.parse(String(init?.body)));
          if (!parsed.success || parsed.data.revision !== (style?.revision ?? 0))
            return Response.json(
              { error: 'The saved style changed. Reload before applying.' },
              { status: 409 },
            );
          const now = new Date().toISOString();
          style = {
            id: 'note-style-fictional-doctor',
            revision: parsed.data.revision + 1,
            body: parsed.data.body,
            createdAt: style?.createdAt ?? now,
            updatedAt: now,
          };
          return Response.json({ record: style });
        }
      }
      return Response.json({ error: 'Fictional template not found.' }, { status: 404 });
    }
    return documents.fetcher(input, init);
  };
  return {
    fetcher,
    failNextSave: () => {
      failNextSave = true;
    },
  };
}
