import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { DEFAULT_SCRIBE_NOTE_STYLE } from './scribe-personalization-contracts';

const state = vi.hoisted(() => ({
  vertical: 'DOCTOR',
  authorized: true,
  prescribing: true,
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('./auth-server', () => ({
  requireCapability: vi.fn(async (_req: unknown, capability: string) => {
    if (!state.authorized || (capability === 'PRESCRIPTION_DRAFTING' && !state.prescribing))
      return {
        ok: false,
        response: NextResponse.json({ error: 'Not authorized' }, { status: 403 }),
      };
    return { ok: true, value: { psychologistId: 'doctor-1', user: { vertical: state.vertical } } };
  }),
}));
vi.mock('./phi-write-lock', () => ({ ClientPhiWriteForbiddenError: class extends Error {} }));
vi.mock('./scribe-workspace-store', () => ({
  listScribeRecords: state.list,
  getScribeRecord: state.get,
  createScribeRecord: state.create,
  updateScribeRecord: state.update,
  deleteScribeRecord: state.remove,
}));
import { GET as listFavorites, POST as createFavorite } from '../app/api/v1/scribe/shortcuts/route';
import {
  PATCH as updateFavorite,
  DELETE as deleteFavorite,
} from '../app/api/v1/scribe/shortcuts/[id]/route';
import { GET as getStyle, PUT as putStyle } from '../app/api/v1/scribe/note-styles/route';
import { ScribeWorkspaceError } from './scribe-workspace-auth';

const medication = { type: 'medication', title: 'Example', med: { drug: 'Example drug' } };
const phrase = { type: 'phrase', title: 'Opening', field: 'hpi', text: 'Reviewed concerns.' };
const context = { params: Promise.resolve({ id: 'favorite-1' }) };
function request(method: string, body?: unknown) {
  return new NextRequest('http://localhost/api/v1/scribe/shortcuts?psychologistId=other-doctor', {
    method,
    ...(body
      ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }
      : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.vertical = 'DOCTOR';
  state.authorized = true;
  state.prescribing = true;
  state.list.mockResolvedValue([]);
  state.get.mockResolvedValue({ id: 'favorite-1', revision: 2, body: medication });
  state.create.mockResolvedValue({ id: 'favorite-1', revision: 1, body: phrase });
  state.update.mockResolvedValue({ id: 'favorite-1', revision: 3, body: phrase });
  state.remove.mockResolvedValue(undefined);
});

describe('Scribe preference authorization and persistence', () => {
  it('requires prescribing authority for sets containing medication on create, edit and delete', async () => {
    const body = { type: 'set', title: 'Prescription set', items: [medication] };
    state.prescribing = false;
    state.get.mockResolvedValue({ id: 'favorite-1', revision: 2, body });
    expect((await createFavorite(request('POST', body))).status).toBe(403);
    expect(
      (await updateFavorite(request('PATCH', { revision: 2, body: phrase }), context)).status,
    ).toBe(403);
    expect((await deleteFavorite(request('DELETE', { revision: 2 }), context)).status).toBe(403);
    expect(state.create).not.toHaveBeenCalled();
    expect(state.update).not.toHaveBeenCalled();
    expect(state.remove).not.toHaveBeenCalled();
  });
  it('persists, revises and deletes investigation sets through the same owner and revision checks', async () => {
    const body = {
      type: 'set',
      title: 'Investigation set',
      items: [
        { type: 'investigation', title: 'Test A', name: 'Test A' },
        { type: 'advice', title: 'Reports', text: 'Return with reports.' },
      ],
    };
    state.prescribing = false;
    state.get.mockResolvedValue({ id: 'favorite-1', revision: 2, body });
    expect((await createFavorite(request('POST', body))).status).toBe(201);
    const revised = { ...body, title: 'Revised investigation set' };
    expect(
      (await updateFavorite(request('PATCH', { revision: 2, body: revised }), context)).status,
    ).toBe(200);
    expect(state.update).toHaveBeenCalledWith(
      { psychologistId: 'doctor-1', kind: 'shortcut' },
      'favorite-1',
      2,
      revised,
    );
    expect((await deleteFavorite(request('DELETE', { revision: 2 }), context)).status).toBe(200);
    expect(state.remove).toHaveBeenCalledWith(
      { psychologistId: 'doctor-1', kind: 'shortcut' },
      'favorite-1',
      2,
    );
  });
  it('rejects unauthorized and non-doctor callers before touching preference storage', async () => {
    state.authorized = false;
    expect((await listFavorites(request('GET'))).status).toBe(403);
    state.authorized = true;
    state.vertical = 'THERAPIST';
    expect((await createFavorite(request('POST', phrase))).status).toBe(403);
    expect(state.list).not.toHaveBeenCalled();
    expect(state.create).not.toHaveBeenCalled();
  });
  it('always scopes reads and writes to the authenticated doctor without client or session identifiers', async () => {
    await listFavorites(request('GET'));
    expect(state.list.mock.calls[0][0]).toEqual({ psychologistId: 'doctor-1', kind: 'shortcut' });
    await createFavorite(request('POST', phrase));
    expect(state.create).toHaveBeenCalledWith(
      { psychologistId: 'doctor-1', kind: 'shortcut' },
      phrase,
    );
    expect(
      (await createFavorite(request('POST', { ...phrase, sessionId: 'foreign-session' }))).status,
    ).toBe(400);
  });
  it('requires prescribing authority for medication creation, replacement and deletion', async () => {
    state.prescribing = false;
    expect((await createFavorite(request('POST', medication))).status).toBe(403);
    expect(
      (await updateFavorite(request('PATCH', { revision: 2, body: phrase }), context)).status,
    ).toBe(403);
    expect((await deleteFavorite(request('DELETE', { revision: 2 }), context)).status).toBe(403);
    expect(state.create).not.toHaveBeenCalled();
    expect(state.update).not.toHaveBeenCalled();
    expect(state.remove).not.toHaveBeenCalled();
  });
  it('passes optimistic revisions to update/delete and reports conflicts without overwriting', async () => {
    state.update.mockRejectedValueOnce(
      new ScribeWorkspaceError(409, 'Reload the latest favorite.'),
    );
    expect(
      (await updateFavorite(request('PATCH', { revision: 2, body: medication }), context)).status,
    ).toBe(409);
    expect(state.update.mock.calls[0]).toEqual([
      { psychologistId: 'doctor-1', kind: 'shortcut' },
      'favorite-1',
      2,
      medication,
    ]);
    await deleteFavorite(request('DELETE', { revision: 2 }), context);
    expect(state.remove).toHaveBeenCalledWith(
      { psychologistId: 'doctor-1', kind: 'shortcut' },
      'favorite-1',
      2,
    );
  });
  it('cannot edit a record absent from the doctor scope', async () => {
    state.get.mockResolvedValue(null);
    expect(
      (await updateFavorite(request('PATCH', { revision: 2, body: medication }), context)).status,
    ).toBe(404);
    expect(state.update).not.toHaveBeenCalled();
  });
  it('uses a doctor-specific style id and enforces create versus update revision semantics', async () => {
    state.get.mockResolvedValue(null);
    expect((await getStyle(request('GET'))).status).toBe(200);
    expect(state.get.mock.calls[0][1]).toBe('note-style-doctor-1');
    await putStyle(request('PUT', { revision: 0, body: DEFAULT_SCRIBE_NOTE_STYLE }));
    expect(state.create).toHaveBeenCalledWith(
      { psychologistId: 'doctor-1', kind: 'note_style' },
      DEFAULT_SCRIBE_NOTE_STYLE,
      'note-style-doctor-1',
    );
    await putStyle(request('PUT', { revision: 3, body: DEFAULT_SCRIBE_NOTE_STYLE }));
    expect(state.update).toHaveBeenCalledWith(
      { psychologistId: 'doctor-1', kind: 'note_style' },
      'note-style-doctor-1',
      3,
      DEFAULT_SCRIBE_NOTE_STYLE,
    );
  });
});
