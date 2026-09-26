import { webcrypto } from 'node:crypto';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SCRIBE_BUILTIN_DOCTOR_TEMPLATES,
  ScribeDoctorTemplateResponseSchema,
  ScribeDoctorTemplatesResponseSchema,
  renderScribeDocumentTemplate,
} from './scribe-doctor-templates';
import { DEFAULT_SCRIBE_NOTE_STYLE } from './scribe-personalization-contracts';
import { createScribeTemplatePreviewFixture } from '../app/dev/scribe-templates/template-preview-fixture';
const h = vi.hoisted(() => ({
  doctor: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
}));
vi.mock('./auth-page', () => ({ requireOnboardedDoctor: h.doctor }));
vi.mock('next/navigation', () => ({ notFound: h.notFound }));
import DoctorTemplatesPage from '../app/app/clinic/templates/page';
import PreviewPage from '../app/dev/scribe-templates/page';

const operationId = '00000000-0000-4000-8000-000000000001';
const request = (method: string, body: unknown) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('React', React);
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Real network is forbidden in a preview.');
    }),
  );
  h.doctor.mockResolvedValue({ id: 'doctor-1' });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('doctor template entry points and fictional integration', () => {
  it('requires the onboarded doctor page guard', async () => {
    await DoctorTemplatesPage();
    expect(h.doctor).toHaveBeenCalledOnce();
    h.doctor.mockRejectedValue(new Error('DOCTOR_REQUIRED'));
    await expect(DoctorTemplatesPage()).rejects.toThrow('DOCTOR_REQUIRED');
  });
  it.each([
    ['production', 'true'],
    ['test', 'true'],
    ['development', 'false'],
  ])('hides the preview for %s and flag %s', (environment, flag) => {
    vi.stubEnv('NODE_ENV', environment);
    vi.stubEnv('SCRIBE_WORKSPACE_PREVIEW', flag);
    expect(() => PreviewPage()).toThrow('NOT_FOUND');
  });
  it('enables the preview only with both development gates', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('SCRIBE_WORKSPACE_PREVIEW', 'true');
    expect(PreviewPage()).toBeTruthy();
    expect(h.notFound).not.toHaveBeenCalled();
  });
  it('stores private templates only in page memory, with idempotent create and revision guards', async () => {
    const fixture = createScribeTemplatePreviewFixture();
    const template = structuredClone(SCRIBE_BUILTIN_DOCTOR_TEMPLATES[0]);
    const create = { operationId, template, containsNoPatientData: true };
    const first = ScribeDoctorTemplateResponseSchema.parse(
      await (await fixture.fetcher('/api/v1/scribe/templates', request('POST', create))).json(),
    );
    expect(first.record).toMatchObject({ revision: 1, clientId: null, sessionId: null });
    expect(
      await (await fixture.fetcher('/api/v1/scribe/templates', request('POST', create))).json(),
    ).toEqual(first);
    const edited = { ...template, name: 'My follow-up layout' };
    const saved = ScribeDoctorTemplateResponseSchema.parse(
      await (
        await fixture.fetcher(
          `/api/v1/scribe/templates/${first.record.id}`,
          request('PATCH', { revision: 1, template: edited, containsNoPatientData: true }),
        )
      ).json(),
    );
    expect(saved.record.revision).toBe(2);
    expect(saved.record.body.template.name).toBe(edited.name);
    expect(
      await (await fixture.fetcher('/api/v1/scribe/templates', request('POST', create))).json(),
    ).toEqual(saved);
    expect(
      (
        await fixture.fetcher(
          `/api/v1/scribe/templates/${first.record.id}`,
          request('DELETE', { revision: 1 }),
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await fixture.fetcher(
          `/api/v1/scribe/templates/${first.record.id}`,
          request('DELETE', { revision: 2 }),
        )
      ).status,
    ).toBe(200);
    expect(await (await fixture.fetcher('/api/v1/scribe/templates')).json()).toEqual({
      records: [],
    });
    expect(
      (await fixture.fetcher('/api/v1/scribe/templates', request('POST', create))).status,
    ).toBe(409);
    expect(await (await fixture.fetcher('/api/v1/scribe/templates')).json()).toEqual({
      records: [],
    });
    const fresh = createScribeTemplatePreviewFixture();
    expect(
      ScribeDoctorTemplatesResponseSchema.parse(
        await (await fresh.fetcher('/api/v1/scribe/templates')).json(),
      ).records,
    ).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('applies presentation only through explicit style PUT, with no template save side effect', async () => {
    const fixture = createScribeTemplatePreviewFixture();
    await fixture.fetcher(
      '/api/v1/scribe/templates',
      request('POST', {
        operationId,
        template: SCRIBE_BUILTIN_DOCTOR_TEMPLATES[1],
        containsNoPatientData: true,
      }),
    );
    expect(await (await fixture.fetcher('/api/v1/scribe/note-styles')).json()).toEqual({
      record: null,
    });
    const style = structuredClone(DEFAULT_SCRIBE_NOTE_STYLE);
    style.followUp.order.reverse();
    const result = await (
      await fixture.fetcher(
        '/api/v1/scribe/note-styles',
        request('PUT', { revision: 0, body: style }),
      )
    ).json();
    expect(result.record.body).toEqual(style);
    expect(result.record.revision).toBe(1);
    expect(
      (
        await fixture.fetcher(
          '/api/v1/scribe/note-styles',
          request('PUT', { revision: 0, body: style }),
        )
      ).status,
    ).toBe(409);
  });
  it('keeps failed saves out of saved records and refuses unknown clinical destinations', async () => {
    const fixture = createScribeTemplatePreviewFixture();
    fixture.failNextSave();
    expect(
      (
        await fixture.fetcher(
          '/api/v1/scribe/templates',
          request('POST', {
            operationId,
            template: SCRIBE_BUILTIN_DOCTOR_TEMPLATES[0],
            containsNoPatientData: true,
          }),
        )
      ).status,
    ).toBe(503);
    expect(await (await fixture.fetcher('/api/v1/scribe/templates')).json()).toEqual({
      records: [],
    });
    expect((await fixture.fetcher('/api/v1/real-patient-data')).status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps template placeholders as draft-only additions without modifying signed excerpts', async () => {
    const fixture = createScribeTemplatePreviewFixture();
    const created = await (
      await fixture.fetcher(
        '/api/v1/scribe/encounters/fictional-visit/documents',
        request('POST', { operationId, expectedSourceHash: 'a'.repeat(64), types: ['referral'] }),
      )
    ).json();
    const packet = created.packets[0];
    const template = SCRIBE_BUILTIN_DOCTOR_TEMPLATES.find(
      (value) => value.kind === 'document_skeleton' && value.documentType === 'referral',
    )!;
    if (template.kind !== 'document_skeleton') throw new Error('Wrong starter');
    const additions = renderScribeDocumentTemplate(template);
    const update = { revision: 1, documentId: 'referral', additions, reviewed: false };
    const draft = await (
      await fixture.fetcher(`/api/v1/scribe/documents/${packet.id}`, request('PATCH', update))
    ).json();
    expect(draft.packets[0].body.documents[0].sourceSections).toEqual(
      packet.body.documents[0].sourceSections,
    );
    expect(draft.packets[0].body.documents[0].status).toBe('draft');
    expect(
      (
        await fixture.fetcher(
          `/api/v1/scribe/documents/${packet.id}`,
          request('PATCH', { ...update, revision: 2, reviewed: true }),
        )
      ).status,
    ).toBe(409);
    expect(
      (await fixture.fetcher(`/api/v1/scribe/documents/${packet.id}/referral/text?revision=2`))
        .status,
    ).toBe(409);
    expect(fetch).not.toHaveBeenCalled();
  });
});
