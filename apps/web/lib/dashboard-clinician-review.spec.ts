import { describe, expect, it, vi } from 'vitest';

vi.mock('./prisma', () => ({ prisma: {} }));
vi.mock('./crisis-flags', () => ({ fetchOpenCrises: vi.fn() }));
vi.mock('./client-pii', () => ({ decryptClientField: vi.fn() }));
import { dashboardCrisisPresentation, foldDashboardCandidateData } from './dashboard';

const clientId = 'fictional-client';
const first = new Date('2026-08-01T00:00:00.000Z');
const latest = new Date('2026-08-15T00:00:00.000Z');
const completed = [{ clientId, endedAt: latest }];
const plans = [{ clientId, confirmedAt: first }];
const series = (instrumentKey: string, scores: number[]) =>
  scores.map((score, i) => ({
    clientId,
    instrumentKey,
    score,
    administeredAt: i === 0 ? first : latest,
  }));

describe('dashboard reviews do not decide discharge or require screening', () => {
  it('links clinician-written safety context to the genuine source and labels unfinished drafts', () => {
    const row = {
      clientId,
      clientName: 'Fictional',
      kind: 'clinician_draft_documented_risk',
      severity: 'critical' as const,
      lastSeenAt: latest.toISOString(),
      source: 'CLINICIAN_NOTE_DRAFT' as const,
      sourceSessionId: 'source-session',
    };
    const presentation = dashboardCrisisPresentation(row);
    expect(presentation.href).toBe('/app/sessions/source-session');
    expect(presentation.meta).toContain('Unfinished clinician-written draft — review');
    expect(presentation.meta).toContain('15 Aug 2026');
    expect(presentation.meta).toContain('not a current safety assessment');
    const completed = dashboardCrisisPresentation({ ...row, source: 'CLINICIAN_NOTE' });
    expect(completed.meta).toContain('Clinician-written safety note — review');
    expect(completed.meta).not.toContain('Unfinished');
  });

  it('retains a client destination for legacy flags and sources without a session id', () => {
    const row = {
      clientId,
      clientName: 'Fictional',
      kind: 'self_reported_suicidality',
      severity: 'critical' as const,
      lastSeenAt: latest.toISOString(),
    };
    expect(dashboardCrisisPresentation(row)).toMatchObject({
      href: `/app/clients/${clientId}`,
      meta: expect.stringContaining('self reported suicidality'),
    });
    expect(dashboardCrisisPresentation({ ...row, source: 'CLINICIAN_NOTE' }).href).toBe(
      `/app/clients/${clientId}`,
    );
  });

  it('one improved, low-range screener invites whole-case review, not discharge', () => {
    const result = foldDashboardCandidateData(
      [clientId],
      completed,
      plans,
      series('PHQ9', [18, 3]),
    ).get(clientId)!;
    expect(result.stage).toBe('REVIEW_DUE');
    expect(result.anyImproving).toBe(true);
    expect(result.anyRemission).toBe(true);
    expect(result.anyDeteriorating).toBe(false);
  });

  it('keeps worsening visible when another measure improves into the low range', () => {
    const result = foldDashboardCandidateData([clientId], completed, plans, [
      ...series('PHQ9', [18, 3]),
      ...series('GAD7', [5, 16]),
    ]).get(clientId)!;
    expect(result.stage).toBe('REVIEW_DUE');
    expect(result.anyDeteriorating).toBe(true);
    expect(result.deteriorations).toEqual([{ key: 'GAD7', delta: 11 }]);
  });

  it('worsening warrants review without a formal plan or completed appointment', () => {
    const result = foldDashboardCandidateData([clientId], [], [], series('GAD7', [4, 12])).get(
      clientId,
    )!;
    expect(result.stage).toBe('REVIEW_DUE');
    expect(result.deteriorations).toEqual([{ key: 'GAD7', delta: 8 }]);
  });

  it('counselling can continue without a diagnosis or baseline instrument', () => {
    const result = foldDashboardCandidateData([clientId], completed, plans, []).get(clientId)!;
    expect(result.stage).toBe('ACTIVE_TREATMENT');
    expect(result.tracked).toBe(false);
    expect(result.lastMeasureAt).toBeNull();
    expect(result.deteriorations).toEqual([]);
  });

  it('a single low-range score does not establish improvement or discharge readiness', () => {
    const result = foldDashboardCandidateData(
      [clientId],
      completed,
      plans,
      series('PHQ9', [3]),
    ).get(clientId)!;
    expect(result.stage).toBe('ACTIVE_TREATMENT');
    expect(result.tracked).toBe(false);
    expect(result.anyRemission).toBe(false);
  });

  it('an aged plan prompts review even when screening was not part of care', () => {
    const result = foldDashboardCandidateData(
      [clientId],
      Array.from({ length: 8 }, () => ({ clientId, endedAt: latest })),
      plans,
      [],
    ).get(clientId)!;
    expect(result.stage).toBe('REVIEW_DUE');
    expect(result.lastMeasureAt).toBeNull();
  });

  it('does not infer another client’s care state from unrelated measurements', () => {
    const result = foldDashboardCandidateData(
      [clientId],
      completed,
      plans,
      series('GAD7', [4, 20]).map((row) => ({ ...row, clientId: 'other-client' })),
    ).get(clientId)!;
    expect(result.stage).toBe('ACTIVE_TREATMENT');
    expect(result.anyDeteriorating).toBe(false);
  });
});
