import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ClientPhiWriteForbiddenError, withActiveSessionPhiWrite } from './phi-write-lock';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('asynchronous note-generation PHI serialization', () => {
  it('does not hold the Client lock during LLM latency and rejects persistence when erasure wins', async () => {
    const llm = deferred<{ content: string }>();
    const write = vi.fn();
    const queryRaw = vi.fn().mockResolvedValue([]);
    const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        $queryRaw: queryRaw,
        session: { findUnique: vi.fn() },
      }),
    );

    const generation = (async () => {
      const output = await llm.promise;
      return withActiveSessionPhiWrite(
        { $transaction: transaction } as never,
        'session-1',
        'psy-1',
        (tx) => write(tx, output),
      );
    })();

    expect(transaction).not.toHaveBeenCalled();
    llm.resolve({ content: 'generated PHI' });

    await expect(generation).rejects.toBeInstanceOf(ClientPhiWriteForbiddenError);
    expect(queryRaw).toHaveBeenCalledOnce();
    expect(write).not.toHaveBeenCalled();
  });

  it('locks, rereads ownership and state, then commits one persistence group atomically', async () => {
    const events: string[] = [];
    const tx = {
      $queryRaw: vi.fn(async () => {
        events.push('client-lock');
        return [{ id: 'client-1', psychologistId: 'psy-1' }];
      }),
      session: {
        findUnique: vi.fn(async () => {
          events.push('session-reread');
          return {
            id: 'session-1',
            clientId: 'client-1',
            psychologistId: 'psy-1',
            status: 'COMPLETED',
          };
        }),
      },
    };
    const db = {
      $transaction: vi.fn(async (callback: (transactionClient: typeof tx) => Promise<unknown>) => {
        events.push('transaction-start');
        const result = await callback(tx);
        events.push('transaction-commit');
        return result;
      }),
    };

    await expect(
      withActiveSessionPhiWrite(db as never, 'session-1', 'psy-1', async (_tx, session) => {
        events.push(`write:${session.status}`);
        return 'persisted';
      }),
    ).resolves.toBe('persisted');

    expect(events).toEqual([
      'transaction-start',
      'client-lock',
      'session-reread',
      'write:COMPLETED',
      'transaction-commit',
    ]);
  });

  it('inventories every asynchronous note PHI writer behind the shared lock helper', () => {
    const orchestrator = source('lib/note-orchestrator.ts');
    const assessmentItems = source('lib/assessment-items.ts');
    const transcribeSegment = source('lib/transcribe-segment.ts');

    expect(orchestrator).toContain('ASYNC_NOTE_PHI_WRITE_INVENTORY');
    expect(orchestrator).toContain('withActiveSessionPhiWrite');
    expect(orchestrator).not.toMatch(
      /prisma\.(noteDraft|clinicalReport|differential|medicationOrder|clinicalOrder|clinicalReading)\.(create|createMany|upsert|update|updateMany|deleteMany)/,
    );
    expect(assessmentItems).not.toMatch(
      /prisma\.assessmentItem\.(create|createMany|upsert|update|updateMany|deleteMany)/,
    );
    expect(transcribeSegment).toContain('withActiveSessionPhiWrite');
    expect(transcribeSegment).toContain('PASS_1_SEGMENT_COMPLETED');
    expect(transcribeSegment).toContain('PASS_1_SEGMENT_FAILED');
    expect(transcribeSegment).toContain('PASS_1_CALL_LOG');
    expect(transcribeSegment).not.toContain('await persistCallLog(result.callLog);');
    expect(transcribeSegment).not.toMatch(/prisma\.geminiCallLog\.create/);
    expect(transcribeSegment).not.toMatch(
      /prisma\.transcriptSegment\.(update|updateMany)\([\s\S]{0,300}(transcript:|errorMessage:)/,
    );

    const liveNote = source('app/api/v1/sessions/[id]/live-note/route.ts');
    expect(liveNote).toContain('PASS_9_LIVE_PREWARM_MARKER');
    expect(liveNote).toContain('withActiveSessionPhiWrite');
    expect(liveNote).not.toMatch(/prisma\.differential\.(findUnique|upsert)/);

    for (const writer of [
      'PASS_1_DRAFT_AND_LANGUAGE',
      'PASS_2_THERAPY_DRAFT',
      'PASS_2_MEDICAL_DRAFT',
      'PASS_2_DRAFTED_ORDERS',
      'PASS_2_VITAL_READINGS',
      'PASS_3_REPORT_PENDING',
      'PASS_3_REPORT_COMPLETED',
      'PASS_3_REPORT_FAILED',
      'PASS_3_ASSESSMENT_ITEMS',
      'PASS_9_DIFFERENTIAL_PENDING',
      'PASS_9_DIFFERENTIAL_COMPLETED',
      'PASS_9_DIFFERENTIAL_FAILED',
    ]) {
      expect(orchestrator).toContain(writer);
    }
  });
});
