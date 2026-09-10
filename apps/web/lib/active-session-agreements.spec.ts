import { describe, expect, it, vi } from 'vitest';
import { loadActiveSessionAgreements } from './active-session-agreements';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { withAgreementHomeworkAccess } from './session-agreement-view';

describe('unfinished commitments across the whole case', () => {
  it('does not disclose linked homework under agreement-only documentation access', () => {
    const agreement = {
      id: 'a1',
      sessionId: 's1',
      text: 'Agreed step',
      speaker: 'CLIENT' as const,
      followUp: null,
      createdAt: '2026-09-10',
      homeworkAssignments: [
        {
          id: 'homework',
          sourceAgreementRevision: 0,
          customDescription: 'Private therapy task',
          dueAt: null,
          status: 'PENDING' as const,
        },
      ],
    };
    expect(withAgreementHomeworkAccess(agreement, false)).toMatchObject({
      canUseAsHomework: false,
      homeworkAssignments: undefined,
    });
    expect(withAgreementHomeworkAccess(agreement, true).homeworkAssignments).toEqual(
      agreement.homeworkAssignments,
    );
  });
  it('queries all completed sessions and excludes only done/retired commitments, not older visits', async () => {
    const findMany = vi.fn(async (_query: { where: unknown }) => []);
    const count = vi.fn(async (_query: { where: unknown }) => 0);
    await loadActiveSessionAgreements(
      { sessionAgreement: { findMany, count } } as never,
      'client-1',
      'psy-1',
    );
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          clientId: 'client-1',
          psychologistId: 'psy-1',
          retiredAt: null,
          OR: [{ followUp: null }, { followUp: { in: ['PARTLY', 'NOT_YET'] } }],
          session: { status: 'COMPLETED', clientId: 'client-1', psychologistId: 'psy-1' },
          client: { deletedAt: null },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 21,
      }),
    );
    expect(count.mock.calls[0]![0]).toEqual({ where: findMany.mock.calls[0]![0].where });
  });
  it('retains an old unresolved source and reports remaining pages and total explicitly', async () => {
    const rows = Array.from({ length: 21 }, (_, i) => ({
      id: `agreement-${i}`,
      sessionId: `old-session-${i}`,
      clientId: 'client-1',
      text: `Unfinished ${i}`,
      speaker: 'CLIENT',
      followUp: 'NOT_YET',
      revision: 0,
      revisions: null,
      createdAt: new Date('2025-01-01T10:00:00Z'),
      session: { scheduledAt: new Date('2025-01-01T10:00:00Z') },
      retiredAt: null,
      retirementReason: null,
      homeworkAssignments: [],
    }));
    const result = await loadActiveSessionAgreements(
      {
        sessionAgreement: { findMany: vi.fn(async () => rows), count: vi.fn(async () => 37) },
      } as never,
      'client-1',
      'psy-1',
    );
    expect(result.total).toBe(37);
    expect(result.agreements).toHaveLength(20);
    expect(result.nextCursor).toBe('agreement-19');
    expect(result.agreements[0]).toMatchObject({
      sessionId: 'old-session-0',
      sourceSessionAt: '2025-01-01T10:00:00.000Z',
      followUp: 'NOT_YET',
    });
  });
  it('uses stable cursor ordering instead of a hidden fixed latest-three list', async () => {
    const findMany = vi.fn(async () => []);
    const result = await loadActiveSessionAgreements(
      { sessionAgreement: { findMany, count: vi.fn(async () => 24) } } as never,
      'client-1',
      'psy-1',
      'last-row',
    );
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: { id: 'last-row' }, skip: 1 }),
    );
    expect(result.nextCursor).toBeNull();
  });
  it('keeps homework creation separate from share preview and preserves source-revision guards', () => {
    const ui = readFileSync(
      resolve(import.meta.dirname, '../components/app/AgreementHomework.tsx'),
      'utf8',
    );
    expect(ui).toContain('Save homework — do not send');
    expect(ui).toContain('Preview homework link');
    expect(ui).not.toContain("fetch('/api/v1/share'");
    expect(ui).toContain('sourceAgreementRevision: sourceRevision');
    const prepare = readFileSync(
      resolve(import.meta.dirname, '../components/app/PreparePanel.tsx'),
      'utf8',
    );
    expect(prepare).toContain('Load more active commitments');
    expect(prepare).toMatch(/open\s+source\s+session/);
  });
});
