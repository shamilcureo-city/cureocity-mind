import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getEffectiveCapabilities: vi.fn(),
  psychologistFindUnique: vi.fn(),
  audit: vi.fn(),
  sessionFindUnique: vi.fn(),
  clientFindUnique: vi.fn(),
  safetyPlanFindFirst: vi.fn(),
  computeClientJourney: vi.fn(),
}));

vi.mock('./firebase-admin', () => ({ firebaseAuth: vi.fn(() => null) }));
vi.mock('./capabilities', () => ({
  getEffectiveCapabilities: mocks.getEffectiveCapabilities,
  serializeCapabilities: (effective: { capabilities: Set<string> }) =>
    [...effective.capabilities].sort(),
}));
vi.mock('./audit', () => ({
  auditMetadataFromRequest: vi.fn(() => ({})),
  writeAudit: mocks.audit,
}));
vi.mock('./prisma', () => ({
  prisma: {
    psychologist: { findUnique: mocks.psychologistFindUnique },
    session: { findUnique: mocks.sessionFindUnique },
    client: { findUnique: mocks.clientFindUnique },
    safetyPlan: { findFirst: mocks.safetyPlanFindFirst },
  },
}));
vi.mock('./journey', () => ({
  JourneyError: class JourneyError extends Error {},
  computeClientJourney: mocks.computeClientJourney,
}));

import { GET as getSession } from '../app/api/v1/sessions/[id]/route';
import { PUT as putNoteDraft } from '../app/api/v1/sessions/[id]/note-draft/route';
import { GET as getNotePdf } from '../app/api/v1/sessions/[id]/note/pdf/route';
import { GET as searchNotes } from '../app/api/v1/search/notes/route';
import { GET as getClinicalReportPdf } from '../app/api/v1/sessions/[id]/clinical-report/pdf/route';
import { GET as getTherapyScript } from '../app/api/v1/clients/[id]/therapy-scripts/route';
import { GET as getSafetyPlan } from '../app/api/v1/clients/[id]/safety-plan/route';
import { GET as getJourney } from '../app/api/v1/clients/[id]/journey/route';

const context = { params: Promise.resolve({ id: 'record-1' }) };
const request = (pathname: string, method = 'GET') =>
  new Request(`https://example.test${pathname}`, {
    method,
    ...(method === 'PUT'
      ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) }
      : {}),
  }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...process.env, NODE_ENV: 'test', AUTH_BYPASS: 'true' };
  mocks.psychologistFindUnique.mockResolvedValue({
    id: 'psy-1',
    role: 'THERAPIST',
    vertical: 'THERAPIST',
    deletedAt: null,
    status: 'ACTIVE',
  });
  mocks.audit.mockResolvedValue(undefined);
});

describe('real regulated route boundary behavior', () => {
  it.each([
    ['absent', null],
    ['revoked', 'CLINICAL_PSYCHOLOGIST'],
  ] as const)(
    'denies representative GET, PUT, PDF, search, report, therapy, safety, and measurement routes when authority is %s',
    async (_state, profession) => {
      mocks.getEffectiveCapabilities.mockResolvedValue({
        profession,
        capabilities: new Set(),
        verifiedCredentialKinds: new Set(),
      });

      const responses = await Promise.all([
        getSession(request('/api/v1/sessions/record-1'), context),
        putNoteDraft(request('/api/v1/sessions/record-1/note-draft', 'PUT'), context),
        getNotePdf(request('/api/v1/sessions/record-1/note/pdf'), context),
        searchNotes(request('/api/v1/search/notes?q=sleep')),
        getClinicalReportPdf(request('/api/v1/sessions/record-1/clinical-report/pdf'), context),
        getTherapyScript(request('/api/v1/clients/record-1/therapy-scripts?therapy=CBT'), context),
        getSafetyPlan(request('/api/v1/clients/record-1/safety-plan'), context),
        getJourney(request('/api/v1/clients/record-1/journey'), context),
      ]);

      expect(responses.map((response) => response.status)).toEqual(Array(8).fill(403));
      expect(mocks.audit).toHaveBeenCalledTimes(8);
      expect(mocks.sessionFindUnique).not.toHaveBeenCalled();
      expect(mocks.clientFindUnique).not.toHaveBeenCalled();
      expect(mocks.safetyPlanFindFirst).not.toHaveBeenCalled();
      expect(mocks.computeClientJourney).not.toHaveBeenCalled();
    },
  );
});
