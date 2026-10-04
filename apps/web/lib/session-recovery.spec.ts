import { describe, expect, it, vi } from 'vitest';
import { recoverPractitionerSession } from './session-recovery';

describe('explicit practitioner session recovery', () => {
  it('clears browser identity then server cookie before full sign-in navigation', async () => {
    const order: string[] = [];
    const signOut = vi.fn(async () => {
      order.push('firebase');
    });
    const send = vi.fn(async () => {
      order.push('cookie');
      return new Response('{}');
    });
    const navigate = vi.fn(() => {
      order.push('navigate');
    });
    await recoverPractitionerSession({ fetch: send, signOut, navigate });
    expect(order).toEqual(['firebase', 'cookie', 'navigate']);
    expect(send).toHaveBeenCalledExactlyOnceWith('/api/v1/auth/session', {
      method: 'DELETE',
      credentials: 'same-origin',
      cache: 'no-store',
    });
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/login?reason=session-changed');
  });

  it('does not navigate or silently replay a request when cookie clearing fails', async () => {
    const send = vi.fn(async () => new Response('{}', { status: 503 }));
    const navigate = vi.fn();
    await expect(
      recoverPractitionerSession({ fetch: send, signOut: vi.fn(), navigate }),
    ).rejects.toThrow('Session recovery failed');
    expect(send).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not silently continue after Firebase sign-out fails', async () => {
    const send = vi.fn();
    const navigate = vi.fn();
    await expect(
      recoverPractitionerSession({
        fetch: send,
        signOut: vi.fn(async () => {
          throw new Error('storage unavailable');
        }),
        navigate,
      }),
    ).rejects.toThrow('storage unavailable');
    expect(send).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('leaves navigation with the caller when the network is unavailable', async () => {
    const navigate = vi.fn();
    await expect(
      recoverPractitionerSession({
        fetch: vi.fn(async () => {
          throw new TypeError('Failed to fetch');
        }),
        signOut: vi.fn(),
        navigate,
      }),
    ).rejects.toThrow('Failed to fetch');
    expect(navigate).not.toHaveBeenCalled();
  });
});
