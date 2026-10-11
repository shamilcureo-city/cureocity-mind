import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emitBrowserCaptureLock, subscribeBrowserCaptureLock } from './browser-capture-lock';

let target: EventTarget;
let storage: { setItem: ReturnType<typeof vi.fn> };
const cleanups: Array<() => void> = [];
function subscribe(listener: () => void) {
  const cleanup = subscribeBrowserCaptureLock(listener);
  cleanups.push(cleanup);
  return cleanup;
}
function dispatchStorage(key: string, newValue: string | null, storageArea: unknown = storage) {
  const event = new Event('storage');
  Object.assign(event, { key, newValue, storageArea });
  target.dispatchEvent(event);
}

beforeEach(() => {
  target = new EventTarget();
  storage = { setItem: vi.fn() };
  vi.stubGlobal('window', Object.assign(target, { localStorage: storage }));
});
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.unstubAllGlobals();
});

describe('browser capture lock signal', () => {
  it('notifies local capture synchronously before broadcasting only a fresh random nonce', () => {
    const order: string[] = [];
    storage.setItem.mockImplementation(() => order.push('broadcast'));
    const listener = vi.fn(() => order.push('local'));
    const remove = subscribe(listener);
    emitBrowserCaptureLock();
    expect(order).toEqual(['local', 'broadcast']);
    expect(listener).toHaveBeenCalledOnce();
    expect(storage.setItem).toHaveBeenCalledOnce();
    const [key, nonce] = storage.setItem.mock.calls[0];
    expect(key).toBe('cureocity:browser-capture-lock:nonce');
    expect(nonce).toMatch(/^[a-f0-9-]{36}$/);
    remove();
    emitBrowserCaptureLock();
    expect(storage.setItem.mock.calls[1][1]).not.toBe(nonce);
    expect(listener).toHaveBeenCalledOnce();
  });

  it('receives cross-tab sign-out without rebroadcasting or accepting unrelated storage', () => {
    emitBrowserCaptureLock();
    const [key, nonce] = storage.setItem.mock.calls[0];
    storage.setItem.mockClear();
    const listener = vi.fn();
    subscribe(listener);
    dispatchStorage(key, nonce);
    expect(listener).toHaveBeenCalledOnce();
    expect(storage.setItem).not.toHaveBeenCalled();
    dispatchStorage('unrelated', nonce);
    dispatchStorage(key, null);
    dispatchStorage(key, 'untrusted arbitrary payload');
    dispatchStorage(key, nonce, {});
    expect(listener).toHaveBeenCalledOnce();
  });

  it('still stops local capture if browser storage is blocked', () => {
    storage.setItem.mockImplementation(() => {
      throw new DOMException('Storage blocked', 'SecurityError');
    });
    const listener = vi.fn();
    subscribe(listener);
    expect(() => emitBrowserCaptureLock()).not.toThrow();
    expect(listener).toHaveBeenCalledOnce();
  });

  it('isolates subscriber failures and removes both listeners on cleanup', () => {
    subscribe(() => {
      throw new Error('Consumer failed');
    });
    const listener = vi.fn();
    const remove = subscribe(listener);
    emitBrowserCaptureLock();
    expect(listener).toHaveBeenCalledOnce();
    const [key, nonce] = storage.setItem.mock.calls[0];
    remove();
    emitBrowserCaptureLock();
    dispatchStorage(key, nonce);
    expect(listener).toHaveBeenCalledOnce();
  });

  it('is inert during server rendering and does not read a persisted nonce on subscribe', () => {
    const listener = vi.fn();
    subscribe(listener);
    expect(listener).not.toHaveBeenCalled();
    vi.stubGlobal('window', undefined);
    expect(() => subscribeBrowserCaptureLock(listener)()).not.toThrow();
    expect(() => emitBrowserCaptureLock()).not.toThrow();
    expect(listener).not.toHaveBeenCalled();
  });
});
