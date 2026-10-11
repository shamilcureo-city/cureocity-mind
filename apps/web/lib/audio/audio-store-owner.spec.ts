import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), create: vi.fn(), close: vi.fn() }));
vi.mock('../live-recovery-draft', () => ({ fetchRecoveryContext: mocks.fetch }));
vi.mock('./session-audio-store', () => ({ createSessionAudioStore: mocks.create }));
import { AudioStoreOwner } from './audio-store-owner';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.fetch.mockResolvedValue({ accountId: 'owner', sessionId: 'session', closed: false });
  mocks.create.mockReturnValue({ close: mocks.close });
});

describe('component-owned audio recovery key lifecycle', () => {
  it('coalesces initial reads and never fetches another key after closure', async () => {
    const owner = new AudioStoreOwner('session');
    const [first, second] = await Promise.all([owner.get(), owner.get()]);
    expect(first).toBe(second);
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.fetch).toHaveBeenCalledWith('session', owner.signal);
    owner.close();
    expect(mocks.close).toHaveBeenCalledOnce();
    await expect(owner.get()).rejects.toThrow('Sign in again');
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });

  it('invalidates a late authorized response after logout/unmount', async () => {
    let resolve!: (context: { closed: boolean }) => void;
    const context = { closed: false };
    mocks.fetch.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const owner = new AudioStoreOwner('session');
    const loading = owner.get();
    owner.close();
    resolve(context);
    await expect(loading).rejects.toThrow('cancelled');
    expect(context.closed).toBe(true);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('permits sealing an already captured tail after lock, but blocks recovery and uploads', async () => {
    const owner = new AudioStoreOwner('session');
    const store = await owner.get();
    owner.lock();
    expect(owner.signal.aborted).toBe(true);
    await expect(owner.get()).rejects.toThrow('Sign in again');
    expect(await owner.forPersistence()).toBe(store);
    owner.close();
    await expect(owner.forPersistence()).rejects.toThrow('Sign in again');
  });

  it('does not initialize storage or reopen authorization during cleanup', async () => {
    const owner = new AudioStoreOwner('session');
    owner.lock();
    await expect(owner.forPersistence()).rejects.toThrow('Sign in again');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('allows an explicit retry after a transient key request failure', async () => {
    mocks.fetch.mockRejectedValueOnce(new Error('offline'));
    const owner = new AudioStoreOwner('session');
    await expect(owner.get()).rejects.toThrow('offline');
    await expect(owner.get()).resolves.toBeDefined();
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
});
