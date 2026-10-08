import { NextRequest, NextResponse } from 'next/server';
import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  transaction: vi.fn(),
  lock: vi.fn(),
  account: vi.fn(),
  session: vi.fn(),
  update: vi.fn(),
  encrypt: vi.fn(),
  decrypt: vi.fn(),
}));
vi.mock('./auth-server', () => ({ requirePsychologistId: m.auth }));
vi.mock('./prisma', () => ({ prisma: { $transaction: m.transaction } }));
vi.mock('./tenant-crypto', () => ({ encryptForTenant: m.encrypt, decryptForTenant: m.decrypt }));
import { GET } from '../app/api/v1/auth/recovery-key/route';

let encryptedKey: string | null;
const call = (query = '?sessionId=s-1') =>
  GET(new NextRequest(`https://example.test/api/v1/auth/recovery-key${query}`));
function expectPrivate(response: Response) {
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
}
beforeEach(() => {
  vi.resetAllMocks();
  encryptedKey = null;
  m.auth.mockResolvedValue({
    ok: true,
    value: { psychologistId: 'psy-1', user: { firebaseUid: 'uid-1' } },
  });
  m.account.mockImplementation(async () => ({ browserRecoveryKeyEncrypted: encryptedKey }));
  m.session.mockResolvedValue({ id: 's-1' });
  m.encrypt.mockImplementation(async (_id, key) => `encrypted:${key}`);
  m.decrypt.mockImplementation(async (_id, encrypted) => encrypted.slice('encrypted:'.length));
  m.update.mockImplementation(async ({ data }) => {
    encryptedKey = data.browserRecoveryKeyEncrypted;
    return { count: 1 };
  });
  let tail = Promise.resolve();
  m.transaction.mockImplementation(async (fn) => {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await fn({
        $executeRaw: m.lock,
        psychologist: { findFirst: m.account, updateMany: m.update },
        session: { findFirst: m.session },
      });
    } finally {
      release();
    }
  });
});

describe('authenticated browser recovery key', () => {
  it('returns only an owned session key and persists only tenant-encrypted key material', async () => {
    const response = await call();
    expect(response.status).toBe(200);
    expectPrivate(response);
    const body = await response.json();
    expect(body).toMatchObject({ accountId: 'psy-1', sessionId: 's-1' });
    expect(Buffer.from(body.key, 'base64')).toHaveLength(32);
    const masterKey = m.encrypt.mock.calls[0][1];
    expect(Buffer.from(masterKey, 'base64')).toHaveLength(32);
    expect(masterKey).not.toBe(body.key);
    expect(body.key).toBe(
      createHmac('sha256', Buffer.from(masterKey, 'base64'))
        .update(JSON.stringify(['mind-browser-recovery', 1, 'psy-1', 's-1']))
        .digest('base64'),
    );
    expect(m.update).toHaveBeenCalledWith({
      where: { id: 'psy-1', status: 'ACTIVE', deletedAt: null, browserRecoveryKeyEncrypted: null },
      data: { browserRecoveryKeyEncrypted: `encrypted:${masterKey}` },
    });
    expect(m.account).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'psy-1', status: 'ACTIVE', deletedAt: null } }),
    );
    expect(m.session).toHaveBeenCalledWith({
      where: {
        id: 's-1',
        psychologistId: 'psy-1',
        client: { psychologistId: 'psy-1', deletedAt: null },
      },
      select: { id: true },
    });
    expect(m.lock.mock.calls[0][1]).toBe('browser-recovery:psy-1');
  });

  it('serializes concurrent first-use calls and returns the same durable key', async () => {
    const [a, b] = await Promise.all([call(), call()]);
    expect(await a.json()).toEqual(await b.json());
    expect(m.encrypt).toHaveBeenCalledTimes(1);
    expect(m.update).toHaveBeenCalledTimes(1);
    expect(m.decrypt).toHaveBeenCalledTimes(1);
  });

  it('derives distinct visit keys without releasing or replacing the account master', async () => {
    const first = await (await call()).json();
    const second = await (await call('?sessionId=s-2')).json();
    expect(first.key).not.toBe(second.key);
    expect(m.encrypt).toHaveBeenCalledTimes(1);
    expect(m.update).toHaveBeenCalledTimes(1);
    const firstAgain = await (await call()).json();
    expect(firstAgain.key).toBe(first.key);
  });

  it.each([401, 403])(
    'fails closed for refused authentication (%s), with no key/database work',
    async (status) => {
      m.auth.mockResolvedValue({
        ok: false,
        response: NextResponse.json({ error: 'Sign in again' }, { status }),
      });
      const response = await call();
      expect(response.status).toBe(status);
      expectPrivate(response);
      expect(m.transaction).not.toHaveBeenCalled();
    },
  );

  it('does not return a key for another owner, erased client or unavailable account', async () => {
    m.session.mockResolvedValueOnce(null);
    const missingSession = await call();
    expect(missingSession.status).toBe(404);
    expectPrivate(missingSession);
    m.account.mockResolvedValueOnce(null);
    const unavailableAccount = await call();
    expect(unavailableAccount.status).toBe(404);
    expectPrivate(unavailableAccount);
    expect(m.encrypt).not.toHaveBeenCalled();
    expect(m.decrypt).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
  });

  it.each(['', '?sessionId=', `?sessionId=${'x'.repeat(129)}`])(
    'validates the session before key provisioning (%s)',
    async (query) => {
      const response = await call(query);
      expect(response.status).toBe(400);
      expectPrivate(response);
      expect(m.transaction).not.toHaveBeenCalled();
    },
  );

  it('does not replace an existing undecryptable key and strand old drafts', async () => {
    encryptedKey = 'old-encrypted-key';
    m.decrypt.mockResolvedValue(null);
    const response = await call();
    expect(response.status).toBe(503);
    expectPrivate(response);
    expect(m.encrypt).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
    expect(encryptedKey).toBe('old-encrypted-key');
  });

  it('never releases an unpersisted key after encryption or account-update failure', async () => {
    m.encrypt.mockRejectedValueOnce(new Error('kms down'));
    const encryptionFailed = await call();
    expect(encryptionFailed.status).toBe(503);
    expectPrivate(encryptionFailed);
    expect(m.update).not.toHaveBeenCalled();
    m.update.mockResolvedValueOnce({ count: 0 });
    const changedAccount = await call();
    expect(changedAccount.status).toBe(503);
    expectPrivate(changedAccount);
    expect(await changedAccount.json()).not.toHaveProperty('key');
  });
});
