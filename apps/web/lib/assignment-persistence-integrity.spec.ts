import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mocks = vi.hoisted(() => ({
  sourceSessionId: null as string | null,
  lockedClient: [] as Array<{
    id: string;
    psychologistId: string;
    deletedAt: Date | null;
    status: 'ACTIVE' | 'PAUSED';
  }>,
  lockedSourceSession: [] as Array<{ id: string }>,
  create: vi.fn(),
  writeAudit: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock('@cureocity/contracts', () => ({ CreateExerciseAssignmentInputSchema: {} }));
vi.mock('@cureocity/clinical', () => ({ getExerciseById: vi.fn() }));
vi.mock('./auth-server', () => ({
  requireCapability: vi.fn(async () => ({
    ok: true,
    value: {
      psychologistId: 'psy-1',
      user: { vertical: 'THERAPIST' },
    },
  })),
}));
vi.mock('./validate', () => ({
  parseJson: vi.fn(async () => ({
    ok: true,
    value: {
      clientId: 'client-1',
      exerciseId: 'cbt_thought_record_5col',
      ...(mocks.sourceSessionId && { sourceSessionId: mocks.sourceSessionId }),
    },
  })),
}));
vi.mock('./audit', () => ({
  auditMetadataFromRequest: () => ({}),
  writeAudit: mocks.writeAudit,
}));
vi.mock('./mappers', () => ({ toExerciseAssignment: (row: unknown) => row }));
vi.mock('./sprint5-final-behavior', () => ({ assignmentDueAtMatches: vi.fn(() => true) }));
vi.mock('./prisma', () => {
  const tx = {
    $executeRaw: vi.fn(),
    $queryRaw: mocks.queryRaw,
    exerciseAssignment: {
      findUnique: vi.fn(async () => null),
      create: mocks.create,
    },
  };
  return {
    prisma: {
      client: {
        findUnique: vi.fn(async () => ({
          id: 'client-1',
          psychologistId: 'psy-1',
          deletedAt: null,
        })),
      },
      session: { findFirst: vi.fn(async () => ({ id: mocks.sourceSessionId })) },
      $transaction: (callback: (client: typeof tx) => unknown) => callback(tx),
    },
  };
});

import { POST } from '../app/api/v1/assignments/route';

function request() {
  return new Request('https://mind.example/api/v1/assignments', {
    method: 'POST',
    body: '{}',
  }) as never;
}

function sqlText(callIndex: number): string {
  return Array.from(mocks.queryRaw.mock.calls[callIndex]?.[0] ?? []).join('?');
}

describe('assignment persistence integrity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sourceSessionId = null;
    mocks.lockedClient = [];
    mocks.lockedSourceSession = [];
    mocks.queryRaw.mockImplementation(async () => {
      const callIndex = mocks.queryRaw.mock.calls.length - 1;
      return callIndex === 0 ? mocks.lockedClient : mocks.lockedSourceSession;
    });
    mocks.create.mockResolvedValue({ id: 'assignment-1' });
  });

  it('does not persist or audit when erasure wins the client row lock', async () => {
    const response = await POST(request());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Client not found' });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.writeAudit).not.toHaveBeenCalled();
    expect(sqlText(0)).toContain('FROM "clients"');
    expect(sqlText(0)).toContain('FOR UPDATE');
  });

  it('does not persist or audit when deactivation wins the client row lock', async () => {
    mocks.lockedClient = [
      { id: 'client-1', psychologistId: 'psy-1', deletedAt: null, status: 'PAUSED' },
    ];

    const response = await POST(request());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Client not found' });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });

  it('rejects source provenance that is no longer tenant-owned under lock', async () => {
    mocks.sourceSessionId = 'session-1';
    mocks.lockedClient = [
      { id: 'client-1', psychologistId: 'psy-1', deletedAt: null, status: 'ACTIVE' },
    ];

    const response = await POST(request());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Session not found' });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.writeAudit).not.toHaveBeenCalled();
    expect(sqlText(1)).toContain('FROM "sessions"');
    expect(sqlText(1)).toContain('FOR UPDATE');
  });
});

describe('assignment provenance database integrity', () => {
  it('keeps readable assignments while nulling deleted source provenance through deliberate FKs', () => {
    const schema = readFileSync(join(import.meta.dirname, '../../../prisma/schema.prisma'), 'utf8');
    const migration = readFileSync(
      join(
        import.meta.dirname,
        '../../../prisma/migrations/20260922000000_explicit_homework/migration.sql',
      ),
      'utf8',
    );

    expect(schema).toMatch(
      /sourceSession\s+Session\?\s+@relation\("ExerciseAssignmentSourceSession"[^\n]+onDelete: SetNull\)/,
    );
    expect(schema).toMatch(
      /responseShare\s+PatientShare\?\s+@relation\("ExerciseAssignmentResponseShare"[^\n]+onDelete: SetNull\)/,
    );
    expect(migration).toContain('exercise_assignments_sourceSessionId_fkey');
    expect(migration).toContain('exercise_assignments_responseShareId_fkey');
    expect(migration).toContain('ON DELETE SET NULL ON UPDATE CASCADE');
    expect(migration).toContain('s."clientId" <> assignment."clientId"');
    expect(migration).toContain('share."psychologistId" <> assignment."psychologistId"');
  });
});
