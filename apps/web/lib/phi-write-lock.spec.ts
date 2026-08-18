import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ClientPhiWriteForbiddenError, lockActiveClientForSession } from './phi-write-lock';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('DPDP PHI write serialization', () => {
  it('locks the Client row through the Session and fails closed after erasure', async () => {
    const queryRaw = vi.fn().mockResolvedValue([]);

    await expect(
      lockActiveClientForSession({ $queryRaw: queryRaw } as never, 'session-1'),
    ).rejects.toBeInstanceOf(ClientPhiWriteForbiddenError);

    const sql = Array.from(queryRaw.mock.calls[0]![0] as TemplateStringsArray).join('?');
    expect(sql).toContain('FROM "clients" c');
    expect(sql).toContain('JOIN "sessions" s');
    expect(sql).toContain('c."deletedAt" IS NULL');
    expect(sql).toContain('FOR UPDATE OF c');
  });

  it.each([
    'app/api/v1/sessions/[id]/sign/route.ts',
    'app/api/v1/sessions/[id]/note/edit/route.ts',
    'app/api/v1/sessions/[id]/note/unlock/route.ts',
    'app/api/v1/sessions/[id]/note-draft/route.ts',
    'app/api/v1/sessions/[id]/note/modify/route.ts',
    'app/api/v1/sessions/[id]/rx-pad/route.ts',
    'app/api/v1/sessions/[id]/live-note/route.ts',
    'app/api/v1/sessions/[id]/end/route.ts',
  ])('%s locks and rechecks the active client in its write transaction', (path) => {
    const route = source(path);
    expect(route).toContain('lockActiveClientForSession');
    expect(route).toMatch(
      /\$transaction\(async \(tx\) =>[\s\S]*lockActiveClientForSession\(tx, sessionId/,
    );
  });

  it('locks and rechecks the active Client inside safety-plan replacement', () => {
    const route = source('app/api/v1/clients/[id]/safety-plan/route.ts');
    expect(route).toContain('lockActiveClient');
    expect(route).toMatch(/\$transaction\(async \(tx\) =>[\s\S]*lockActiveClient\(tx, clientId/);
  });

  it('marks the client terminal before any signed-note or child redaction', () => {
    const erasure = source('lib/dpdp-erasure.ts');
    const terminal = erasure.indexOf('deletedAt: now');
    const signedRedaction = erasure.indexOf('redact_client_signed_note_phi');
    const childRedaction = erasure.indexOf('tx.letter.deleteMany');
    expect(terminal).toBeGreaterThan(-1);
    expect(terminal).toBeLessThan(signedRedaction);
    expect(terminal).toBeLessThan(childRedaction);
  });
});
