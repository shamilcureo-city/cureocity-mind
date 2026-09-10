import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { AgreementFollowUpConflictError, saveAgreementFollowUp } from './agreement-follow-up-save';

const agreement = { id: 'agreement', sessionId: 'session', revision: 3 };
describe('follow-up applies only to reviewed wording and acknowledged writes', () => {
  it('submits the observed agreement revision and resolves only for an explicit receipt', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true }));
    await expect(saveAgreementFollowUp(agreement, 'DONE', request)).resolves.toBeUndefined();
    expect(JSON.parse(request.mock.calls[0]![1]!.body as string)).toEqual({
      followUp: 'DONE',
      expectedRevision: 3,
    });
    expect(request.mock.calls[0]![0]).toBe('/api/v1/sessions/session/agreements/agreement');
  });
  it('uses revision zero only for a legacy uncorrected DTO', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true }));
    await saveAgreementFollowUp({ id: 'agreement', sessionId: 'session' }, 'PARTLY', request);
    expect(JSON.parse(request.mock.calls[0]![1]!.body as string).expectedRevision).toBe(0);
  });
  it('requires reloading latest wording on a revision conflict, without automatically retrying it', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ error: 'changed' }, { status: 409 }));
    await expect(saveAgreementFollowUp(agreement, 'DONE', request)).rejects.toBeInstanceOf(
      AgreementFollowUpConflictError,
    );
    expect(request).toHaveBeenCalledOnce();
  });
  it.each([
    Response.json({ ok: false }),
    Response.json({}),
    new Response('not-json'),
    new Response(null, { status: 500 }),
  ])('does not acknowledge malformed or failed responses', async (response) => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response);
    await expect(saveAgreementFollowUp(agreement, 'DONE', request)).rejects.toThrow();
  });
  it('does not turn a lost response into a successful mark', async () => {
    const request = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Network error'));
    await expect(saveAgreementFollowUp(agreement, 'NOT_YET', request)).rejects.toThrow(
      'Network error',
    );
  });
  it('keeps the pending choice, serializes clicks and changes selection only after acknowledgment', () => {
    const source = readFileSync(
      join(import.meta.dirname, '../components/app/PreparePanel.tsx'),
      'utf8',
    );
    const start = source.indexOf('async function mark(');
    const mark = source.slice(start, source.indexOf('async function reloadPending', start));
    expect(mark.indexOf('await saveAgreementFollowUp')).toBeLessThan(mark.indexOf('setRows('));
    expect(mark).toContain('if (busyRef.current) return');
    expect(source).toContain('Reload latest wording');
    expect(source).toContain('Discard unsaved choice');
    expect(source).toContain('disabled={followUpSaving}');
    expect(source).toContain('useUnsavedWorkGuard(');
    const route = readFileSync(
      join(import.meta.dirname, '../app/api/v1/clients/[id]/prepare/route.ts'),
      'utf8',
    );
    expect(route).toContain('revision: r.revision');
  });
});
