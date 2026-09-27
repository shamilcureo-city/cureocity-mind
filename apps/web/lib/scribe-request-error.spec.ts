import { describe, expect, it, vi } from 'vitest';
import {
  classifyScribeRequestError,
  readScribeRequestError,
  safeScribeRequestError,
} from './scribe-request-error';

describe('safe pending-work request errors', () => {
  it('sends an expired session to sign-in without displaying server details', () => {
    const error = classifyScribeRequestError(401, { error: 'private detail' }, 'load');
    expect(error.kind).toBe('sign-in');
    expect(error.blocksAccess).toBe(true);
    expect(error.action?.href).toBe('/login');
    expect(error.message).not.toContain('private detail');
  });

  it.each([{ code: 'PRACTITIONER_INACTIVE' }, { error: 'Practitioner account is not active' }])(
    'recognizes only the supported inactive-account payload: %j',
    (body) => {
      const error = classifyScribeRequestError(403, body, 'load');
      expect(error.kind).toBe('inactive');
      expect(error.blocksAccess).toBe(true);
      expect(error.action).toEqual({ href: '/account-status', label: 'Check account status' });
    },
  );

  it.each([
    null,
    'Practitioner account is not active',
    [{ code: 'PRACTITIONER_INACTIVE' }],
    { code: 'OTHER_RESTRICTION', error: 'Practitioner account is not active' },
    { error: 'Practitioner account is not active: secret account detail' },
    { error: '<script>private detail</script>' },
  ])('does not infer inactivity from an unknown forbidden payload: %j', (body) => {
    const error = classifyScribeRequestError(403, body, 'update');
    expect(error.kind).toBe('forbidden');
    expect(error.blocksAccess).toBe(true);
    expect(error.message).not.toContain('not active');
    expect(error.message).not.toContain('private detail');
    expect(error.action).toEqual({
      href: 'mailto:shamil@cureo.city?subject=Scribe%20account%20access',
      label: 'Contact support',
    });
  });

  it.each([null, 400, 404, 429, 500, 503])('leaves status %s retryable', (status) => {
    const error = classifyScribeRequestError(status, { error: 'private detail' }, 'create');
    expect(error.blocksAccess).toBe(false);
    expect(error.message).toContain('try again');
    expect(error.message).not.toContain('private detail');
  });

  it('only requests conflict refresh for an update', () => {
    expect(classifyScribeRequestError(409, null, 'update').kind).toBe('conflict');
    expect(classifyScribeRequestError(409, null, 'create').kind).toBe('request');
  });

  it('treats invalid JSON as a generic access denial', async () => {
    const error = await readScribeRequestError(
      new Response('<html>private</html>', { status: 403 }),
      'load',
    );
    expect(error.kind).toBe('forbidden');
    expect(error.message).not.toContain('private');
  });

  it('does not read irrelevant error bodies', async () => {
    const response = { status: 500, json: vi.fn() };
    await readScribeRequestError(response, 'load');
    expect(response.json).not.toHaveBeenCalled();
  });

  it('sanitizes thrown network errors while preserving known local errors', () => {
    const failure = safeScribeRequestError(new Error('sensitive URL or response'), 'load');
    expect(failure.message).not.toContain('sensitive');
    expect(failure.blocksAccess).toBe(false);
    expect(safeScribeRequestError(failure, 'load')).toBe(failure);
  });
});
