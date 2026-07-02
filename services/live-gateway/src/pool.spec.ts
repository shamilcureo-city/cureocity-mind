import { describe, expect, it } from 'vitest';
import { GatewayPool } from './pool';

describe('GatewayPool', () => {
  it('grants slots up to the cap, then sheds', () => {
    const pool = new GatewayPool(2);
    expect(pool.tryAcquire()).toBe(true);
    expect(pool.tryAcquire()).toBe(true);
    expect(pool.atCapacity).toBe(true);
    expect(pool.tryAcquire()).toBe(false); // shed
    expect(pool.active).toBe(2);
  });

  it('frees a slot on release so a shed client can retry', () => {
    const pool = new GatewayPool(1);
    expect(pool.tryAcquire()).toBe(true);
    expect(pool.tryAcquire()).toBe(false);
    pool.release();
    expect(pool.active).toBe(0);
    expect(pool.tryAcquire()).toBe(true);
  });

  it('release never underflows below zero', () => {
    const pool = new GatewayPool(1);
    pool.release();
    pool.release();
    expect(pool.active).toBe(0);
    expect(pool.tryAcquire()).toBe(true);
  });
});
