import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import type { PractitionerCapability } from '@cureocity/contracts';

const mocks = vi.hoisted(() => ({
  clientFind: vi.fn(),
  planFind: vi.fn(),
  diagnosisFind: vi.fn(),
  guideFind: vi.fn(),
  sessionFind: vi.fn(),
  assessmentFind: vi.fn(),
  audit: vi.fn(),
  authenticate: vi.fn(),
  capabilities: vi.fn(),
  decrypt: vi.fn(),
  crises: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    client: { findUnique: mocks.clientFind },
    treatmentPlan: { findFirst: mocks.planFind },
    clientDiagnosis: { findFirst: mocks.diagnosisFind },
    therapyScript: { findMany: mocks.guideFind },
    session: { findUnique: mocks.sessionFind },
    assessmentItem: { findMany: mocks.assessmentFind },
  },
}));
vi.mock('@/lib/audit', () => ({ writeAudit: mocks.audit }));
vi.mock('@/lib/auth-page', () => ({ requireOnboardedPsychologist: mocks.authenticate }));
vi.mock('@/lib/capabilities', () => ({ getEffectiveCapabilities: mocks.capabilities }));
vi.mock('@/lib/client-pii', () => ({ decryptClientField: mocks.decrypt }));
vi.mock('@/lib/crisis-flags', () => ({ fetchOpenCrises: mocks.crises }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));
vi.mock('@/components/ui/Container', () => ({ Container: () => null }));
vi.mock('@/components/app/TherapistLiveSession', () => ({ TherapistLiveSession: () => null }));

import { loadPreparedMindGuides } from './load-prepared-mind-guides';
import LivePage from '../app/app/sessions/[id]/live/page';

const savedAt = new Date('2026-09-05T10:00:00Z');
const body = {
  version: 'V1',
  language: 'en',
  therapyName: 'Grounding',
  openingScript: 'Synthetic private opening',
  mainExercise: {
    steps: [
      {
        id: 'step-1',
        purpose: 'Synthetic purpose',
        therapistSays: 'Synthetic cue',
        listenFor: 'Synthetic response',
        branches: [],
      },
    ],
  },
  adaptationCues: [],
  closingScript: 'Synthetic closing',
  homework: { description: 'Synthetic activity', deliveryNotes: 'As agreed' },
  riskWatchpoints: [],
  estimatedDurationMin: 15,
};
const client = { psychologistId: 'psy-1', deletedAt: null };
const session = {
  id: 'session-1',
  psychologistId: 'psy-1',
  clientId: 'client-1',
  kind: 'TREATMENT',
  modality: 'CBT',
  language: 'en',
  status: 'IN_PROGRESS',
  client: {
    ...client,
    fullNameEncrypted: 'encrypted',
    carriedQuestions: [
      {
        question: 'A question explicitly carried',
        rationale: 'Chosen by clinician',
        sourceSessionId: 'previous-session',
        carriedAt: savedAt.toISOString(),
      },
    ],
  },
};
const context = {
  clientId: 'client-1',
  psychologistId: 'psy-1',
  vertical: 'THERAPIST' as const,
  capabilities: new Set<PractitionerCapability>(['THERAPY_WORKFLOWS']),
};

beforeEach(() => {
  vi.resetAllMocks();
  // The server page's JSX is evaluated without mounting client components.
  vi.stubGlobal('React', React);
  mocks.clientFind.mockResolvedValue(client);
  mocks.planFind.mockResolvedValue({ id: 'plan-current' });
  mocks.diagnosisFind.mockResolvedValue({ id: 'diagnosis-current' });
  mocks.guideFind.mockResolvedValue([{ id: 'guide-1', body, updatedAt: savedAt }]);
  mocks.authenticate.mockResolvedValue({ id: 'psy-1', vertical: 'THERAPIST' });
  mocks.capabilities.mockResolvedValue({
    capabilities: new Set<PractitionerCapability>([
      'BEHAVIORAL_HEALTH_DOCUMENTATION',
      'THERAPY_WORKFLOWS',
      'CLINICAL_ANALYSIS',
    ]),
  });
  mocks.sessionFind.mockResolvedValue(session);
  mocks.assessmentFind.mockResolvedValue([]);
  mocks.decrypt.mockResolvedValue('Synthetic client');
  mocks.crises.mockResolvedValue([]);
});
afterEach(() => vi.unstubAllGlobals());

function expectNoGuideReads() {
  expect(mocks.clientFind).not.toHaveBeenCalled();
  expect(mocks.planFind).not.toHaveBeenCalled();
  expect(mocks.diagnosisFind).not.toHaveBeenCalled();
  expect(mocks.guideFind).not.toHaveBeenCalled();
  expect(mocks.audit).not.toHaveBeenCalled();
}

describe('previously prepared Mind guide loader', () => {
  it('does not read protected context when workflow capability is absent', async () => {
    await expect(loadPreparedMindGuides({ ...context, capabilities: new Set() })).resolves.toEqual(
      [],
    );
    expectNoGuideReads();
  });

  it('does not read therapist guides for a doctor even with workflow capability', async () => {
    await expect(loadPreparedMindGuides({ ...context, vertical: 'DOCTOR' })).resolves.toEqual([]);
    expectNoGuideReads();
  });

  it.each([
    ['missing', null],
    ['foreign', { ...client, psychologistId: 'another-practitioner' }],
    ['archived/erased', { ...client, deletedAt: savedAt }],
  ] as const)(
    'omits all guides for a %s client before plan/diagnosis reads',
    async (_label, row) => {
      mocks.clientFind.mockResolvedValue(row);
      await expect(loadPreparedMindGuides(context)).resolves.toEqual([]);
      expect(mocks.planFind).not.toHaveBeenCalled();
      expect(mocks.diagnosisFind).not.toHaveBeenCalled();
      expect(mocks.guideFind).not.toHaveBeenCalled();
      expect(mocks.audit).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['plan-current', 'diagnosis-current'],
    ['plan-current', null],
    [null, 'diagnosis-current'],
    [null, null],
  ])(
    'loads only matching current grounding (%s, %s), never an obsolete plan or diagnosis',
    async (planId, diagnosisId) => {
      mocks.planFind.mockResolvedValue(planId ? { id: planId } : null);
      mocks.diagnosisFind.mockResolvedValue(diagnosisId ? { id: diagnosisId } : null);
      await loadPreparedMindGuides(context);
      expect(mocks.planFind).toHaveBeenCalledWith({
        where: { clientId: 'client-1', psychologistId: 'psy-1', supersededAt: null },
        orderBy: { version: 'desc' },
        select: { id: true },
      });
      expect(mocks.diagnosisFind).toHaveBeenCalledWith({
        where: {
          clientId: 'client-1',
          psychologistId: 'psy-1',
          isPrimary: true,
          supersededAt: null,
        },
        orderBy: { confirmedAt: 'desc' },
        select: { id: true },
      });
      expect(mocks.guideFind).toHaveBeenCalledWith({
        where: {
          clientId: 'client-1',
          psychologistId: 'psy-1',
          sourceTreatmentPlanId: planId,
          sourcePrimaryDiagnosisId: diagnosisId,
          client: { psychologistId: 'psy-1', deletedAt: null },
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: 5,
        select: { id: true, body: true, updatedAt: true },
      });
    },
  );

  it('returns only validated serializable fields and audits exactly the disclosed guide IDs', async () => {
    mocks.guideFind.mockResolvedValue([
      {
        id: 'guide-1',
        body: { ...body, hiddenExtra: 'not in the contract' },
        updatedAt: savedAt,
        totalCostInr: 900,
      },
      { id: 'guide-invalid', body: { version: 'V1' }, updatedAt: savedAt },
      { id: 'guide-2', body, updatedAt: savedAt },
    ]);
    const guides = await loadPreparedMindGuides(context);
    expect(guides).toEqual([
      { id: 'guide-1', body, updatedAt: savedAt.toISOString() },
      { id: 'guide-2', body, updatedAt: savedAt.toISOString() },
    ]);
    expect(JSON.parse(JSON.stringify(guides))).toEqual(guides);
    expect(mocks.audit.mock.calls.map(([entry]) => entry.targetId)).toEqual(['guide-1', 'guide-2']);
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorPsychologistId: 'psy-1',
        action: 'THERAPY_SCRIPT_VIEWED',
        targetType: 'TherapyScript',
        metadata: {
          clientId: 'client-1',
          therapyName: 'Grounding',
          language: 'en',
          source: 'prepared_live_guide',
        },
      }),
    );
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain(body.openingScript);
  });

  it('does not disclose guides if the required view audit fails', async () => {
    mocks.audit.mockRejectedValue(new Error('audit unavailable'));
    await expect(loadPreparedMindGuides(context)).rejects.toThrow('audit unavailable');
  });
});

function loadPage() {
  return LivePage({
    params: Promise.resolve({ id: 'session-1' }),
    searchParams: Promise.resolve({}),
  });
}

async function liveProps() {
  const element = await loadPage();
  return (element.props as { children: React.ReactElement<Record<string, unknown>> }).children
    .props;
}

describe('live Mind page prepared-guide boundary', () => {
  it('redirects doctors before resolving client or guide data', async () => {
    mocks.authenticate.mockResolvedValue({ id: 'doctor-1', vertical: 'DOCTOR' });
    await expect(loadPage()).rejects.toThrow('REDIRECT:/app/clinic');
    expect(mocks.capabilities).not.toHaveBeenCalled();
    expect(mocks.sessionFind).not.toHaveBeenCalled();
    expectNoGuideReads();
  });

  it('requires behavioral documentation before reading the live session', async () => {
    mocks.capabilities.mockResolvedValue({ capabilities: new Set(['THERAPY_WORKFLOWS']) });
    await expect(loadPage()).rejects.toThrow('NOT_FOUND');
    expect(mocks.sessionFind).not.toHaveBeenCalled();
    expectNoGuideReads();
  });

  it.each([
    ['foreign session', { ...session, psychologistId: 'another-practitioner' }],
    [
      'foreign client',
      { ...session, client: { ...session.client, psychologistId: 'another-practitioner' } },
    ],
    ['archived client', { ...session, client: { ...session.client, deletedAt: savedAt } }],
  ] as const)('rejects a %s before decryption or guide disclosure', async (_label, row) => {
    mocks.sessionFind.mockResolvedValue(row);
    await expect(loadPage()).rejects.toThrow('NOT_FOUND');
    expect(mocks.decrypt).not.toHaveBeenCalled();
    expect(mocks.assessmentFind).not.toHaveBeenCalled();
    expectNoGuideReads();
  });

  it('keeps explicit carried questions and prior crisis behavior without reading unauthorized optional data', async () => {
    mocks.capabilities.mockResolvedValue({
      capabilities: new Set(['BEHAVIORAL_HEALTH_DOCUMENTATION']),
    });
    mocks.crises.mockResolvedValue([{ kind: 'suicidal_ideation' }]);
    expect(await liveProps()).toMatchObject({
      preparedGuides: [],
      priorRisk: true,
      carriedQuestions: [{ question: 'A question explicitly carried', why: 'Chosen by clinician' }],
    });
    expect(mocks.assessmentFind).not.toHaveBeenCalled();
    expectNoGuideReads();
  });

  it('supplies saved guides and preserves authorized ranked/deduplicated questions', async () => {
    mocks.assessmentFind.mockResolvedValue([
      { kind: 'ASSESSMENT_GAP', question: 'An open assessment question', rationale: 'Explore' },
      { kind: 'SAFETY', question: 'A question explicitly carried', rationale: 'Duplicate' },
    ]);
    expect(await liveProps()).toMatchObject({
      preparedGuides: [{ id: 'guide-1', body, updatedAt: savedAt.toISOString() }],
      carriedQuestions: [
        { question: 'A question explicitly carried', why: 'Chosen by clinician' },
        { question: 'An open assessment question', why: 'Explore' },
      ],
    });
    expect(mocks.assessmentFind).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clientId: 'client-1', psychologistId: 'psy-1', status: 'OPEN' },
      }),
    );
  });
});
