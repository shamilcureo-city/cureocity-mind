import { describe, expect, it } from 'vitest';
import { parseSharesPerHourCap } from './share-rate-cap';

const DEFAULT_CAP = 30;

describe('SHARES_PER_HOUR_CAP parsing', () => {
  it.each([
    undefined,
    '',
    '   ',
    'garbage',
    '-1',
    'Infinity',
    '-Infinity',
    'NaN',
    '1.5',
    '1e2',
    '0x10',
    '+1',
    '1_0',
  ])('uses the documented default for unsafe value %s', (raw) => {
    expect(parseSharesPerHourCap(raw)).toBe(DEFAULT_CAP);
  });

  it.each([
    ['0', 0],
    ['1', 1],
    ['30', 30],
    ['9007199254740991', Number.MAX_SAFE_INTEGER],
  ])('accepts intentional non-negative integer value %s', (raw, expected) => {
    expect(parseSharesPerHourCap(raw)).toBe(expected);
  });

  it('rejects integers that cannot be represented safely', () => {
    expect(parseSharesPerHourCap('9007199254740992')).toBe(DEFAULT_CAP);
  });
});
