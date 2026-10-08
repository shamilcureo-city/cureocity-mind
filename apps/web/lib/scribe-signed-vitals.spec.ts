import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MedicalEncounterNoteV1Schema } from '@cureocity/contracts';
const h = vi.hoisted(() => ({ readings: vi.fn(), sessions: vi.fn() }));
vi.mock('./prisma', () => ({
  prisma: { clinicalReading: { findMany: h.readings }, session: { findMany: h.sessions } },
}));
import { buildChronicTrajectory } from './chronic-trajectory';
const date = new Date('2026-10-01T10:00:00Z');
const note = (vitals = {}) => MedicalEncounterNoteV1Schema.parse({ version: 'V1', vitals });
const signed = (content: unknown) => ({ id: 's1', scheduledAt: date, therapyNote: { content } });
beforeEach(() => {
  vi.resetAllMocks();
  h.readings.mockResolvedValue([]);
  h.sessions.mockResolvedValue([]);
});
describe('clinical trends use reviewed canonical vital sources', () => {
  it('excludes historical unreviewed NOTE_VITALS rows and unsigned/reopened notes', async () => {
    expect((await buildChronicTrajectory('c1', 'p1')).measures).toEqual([]);
    expect(h.readings).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clientId: 'c1', psychologistId: 'p1', source: { not: 'NOTE_VITALS' } },
      }),
    );
    expect(h.sessions).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          clientId: 'c1',
          psychologistId: 'p1',
          status: 'COMPLETED',
          therapyNote: { locked: true },
          psychologist: { vertical: 'DOCTOR' },
        }),
      }),
    );
  });
  it('uses clinician-corrected signed BP and weight instead of the original AI values', async () => {
    h.sessions.mockResolvedValue([
      signed(note({ bpSystolic: 122, bpDiastolic: 78, weightKg: 62 })),
    ]);
    const result = await buildChronicTrajectory('c1', 'p1');
    expect(result.measures.find((m) => m.measure === 'BP')?.latest).toMatchObject({
      value: 122,
      valueSecondary: 78,
    });
    expect(result.measures.find((m) => m.measure === 'WEIGHT')?.latest?.value).toBe(62);
  });
  it('does not retain removed values when the current signed note has no vitals', async () => {
    h.sessions.mockResolvedValue([signed(note())]);
    expect((await buildChronicTrajectory('c1', 'p1')).measures).toEqual([]);
  });
  it('retains manually measured vitals without double counting the same encounter measure', async () => {
    h.readings.mockResolvedValue([
      {
        sessionId: 's1',
        measure: 'BP',
        value: 118,
        valueSecondary: 76,
        takenAt: date,
        source: 'MANUAL_ENTRY',
      },
    ]);
    h.sessions.mockResolvedValue([
      signed(note({ bpSystolic: 122, bpDiastolic: 78, weightKg: 62 })),
    ]);
    const result = await buildChronicTrajectory('c1', 'p1');
    expect(result.measures.find((m) => m.measure === 'BP')?.series).toHaveLength(1);
    expect(result.measures.find((m) => m.measure === 'BP')?.latest?.value).toBe(118);
    expect(result.measures.find((m) => m.measure === 'WEIGHT')?.latest?.value).toBe(62);
  });
  it('refuses a malformed signed source instead of presenting a partial history', async () => {
    h.sessions.mockResolvedValue([signed({ version: 'INVALID' })]);
    await expect(buildChronicTrajectory('c1', 'p1')).rejects.toThrow('could not be verified');
  });
});
