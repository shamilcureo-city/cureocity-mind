import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireCapability: vi.fn(),
  sessionFindFirst: vi.fn(),
  exerciseAssignmentFindFirst: vi.fn(),
  treatmentPlanFindFirst: vi.fn(),
}));

vi.mock('./auth-server', () => ({ requireCapability: mocks.requireCapability }));
vi.mock('./prisma', () => ({
  prisma: {
    session: { findFirst: mocks.sessionFindFirst },
    exerciseAssignment: { findFirst: mocks.exerciseAssignmentFindFirst },
    treatmentPlan: { findFirst: mocks.treatmentPlanFindFirst },
  },
}));

import { GET as mindShareOptions } from '../app/api/v1/sessions/[id]/mind-share-options/route';
import {
  hydrateMindOutcomeSelection,
  shouldSavePatientTakeaway,
  type MindOutcomeCandidate,
} from './mind-care-loop';

function request() {
  return new Request('https://mind.example.test/api/v1/sessions/session-1/mind-share-options', {
    method: 'GET',
  }) as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireCapability.mockImplementation(
    async (_request, _capability, priorAuth) =>
      priorAuth ?? {
        ok: true,
        value: {
          psychologistId: 'therapist-1',
          user: {
            vertical: 'THERAPIST',
            capabilities: ['PATIENT_SHARING', 'BEHAVIORAL_HEALTH_DOCUMENTATION'],
          },
        },
      },
  );
  mocks.sessionFindFirst.mockResolvedValue({
    id: 'session-1',
    clientId: 'client-1',
    kind: 'TREATMENT',
    mindCloseout: { patientTakeaway: 'Practise the grounding sequence before bed.' },
    therapyNote: { locked: true },
  });
  mocks.exerciseAssignmentFindFirst.mockResolvedValue(null);
  mocks.treatmentPlanFindFirst.mockResolvedValue(null);
});

describe('B07 persisted patient takeaway reload', () => {
  it('returns the persisted takeaway only from the authorized tenant-owned Mind session', async () => {
    const response = await mindShareOptions(request(), {
      params: Promise.resolve({ id: 'session-1' }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(mocks.requireCapability).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      'PATIENT_SHARING',
    );
    expect(mocks.requireCapability).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'BEHAVIORAL_HEALTH_DOCUMENTATION',
      expect.anything(),
    );
    expect(mocks.sessionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'session-1',
          psychologistId: 'therapist-1',
          status: 'COMPLETED',
          client: { is: { deletedAt: null, status: 'ACTIVE' } },
        },
      }),
    );
    await expect(response.json()).resolves.toEqual({
      candidates: [
        {
          label: 'Session takeaway',
          artefact: { artefactType: 'SESSION_TAKEAWAY', sessionId: 'session-1' },
          patientTakeaway: 'Practise the grounding sequence before bed.',
        },
        {
          label: 'Next-session check-in',
          artefact: {
            artefactType: 'INSTRUMENT_CHECKIN',
            clientId: 'client-1',
            instrumentKey: 'PHQ9',
            sessionId: 'session-1',
          },
        },
        {
          label: 'Full signed note',
          secondary: true,
          artefact: { artefactType: 'SIGNED_NOTE', sessionId: 'session-1' },
        },
      ],
    });
  });

  it('does not expose persisted takeaways to the Doctor/Scribe vertical', async () => {
    mocks.requireCapability.mockImplementation(
      async (_request, _capability, priorAuth) =>
        priorAuth ?? {
          ok: true,
          value: {
            psychologistId: 'doctor-1',
            user: {
              vertical: 'DOCTOR',
              capabilities: ['PATIENT_SHARING', 'BEHAVIORAL_HEALTH_DOCUMENTATION'],
            },
          },
        },
    );

    const response = await mindShareOptions(request(), {
      params: Promise.resolve({ id: 'session-1' }),
    });

    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual({ error: 'Not found' });
    expect(mocks.sessionFindFirst).not.toHaveBeenCalled();
  });

  it('hydrates and selects the persisted takeaway for resend without an overwrite save', () => {
    const candidates: MindOutcomeCandidate[] = [
      {
        label: 'Session takeaway',
        artefact: { artefactType: 'SESSION_TAKEAWAY', sessionId: 'session-1' },
        patientTakeaway: 'Practise the grounding sequence before bed.',
      },
      {
        label: 'Full signed note',
        secondary: true,
        artefact: { artefactType: 'SIGNED_NOTE', sessionId: 'session-1' },
      },
    ];

    const reloaded = hydrateMindOutcomeSelection(candidates);

    expect(reloaded.outcomeIndex).toBe(0);
    expect(reloaded.candidates[reloaded.outcomeIndex]?.artefact.artefactType).toBe(
      'SESSION_TAKEAWAY',
    );
    expect(reloaded.takeaway).toBe('Practise the grounding sequence before bed.');
    expect(shouldSavePatientTakeaway(reloaded.takeaway, reloaded.persistedTakeaway)).toBe(false);
    expect(
      shouldSavePatientTakeaway('Practise grounding twice before bed.', reloaded.persistedTakeaway),
    ).toBe(true);
  });
});
