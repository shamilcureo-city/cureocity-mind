import { describe, expect, it } from 'vitest';
import {
  canonicalSessionUsagePayload,
  SessionUsageAckSchema,
  SessionUsageCommandSchema,
  SessionUsageConnectionExportSchema,
  SessionUsageMoneySchema,
  SessionUsageReceiptSchema,
  SessionUsageRegistrationSchema,
} from './session-usage';

const identity = {
  version: 1 as const,
  domain: 'CUREOCITY_LIVE_USAGE_V1' as const,
  connectionId: '00000000-0000-4000-8000-000000000001',
  sessionId: 'fictional-visit',
  psychologistId: 'fictional-owner',
  vertical: 'THERAPIST' as const,
};
const registration = {
  ...identity,
  type: 'REGISTER',
  backend: 'vertex',
  startedAt: '2026-09-13T09:00:00.000Z',
};
const receipt = {
  ...identity,
  type: 'RECEIPT',
  sequence: 1,
  state: 'OPEN',
  endedAt: null,
  totals: {
    inputTokens: 10,
    outputTokens: 20,
    pass1Calls: 1,
    pass2Calls: 1,
    reasoningCalls: 0,
    unknownCalls: 0,
    costInr: '0.3000',
    transcriptionInr: '0.1000',
    notesInr: '0.2000',
    reasoningInr: '0.0000',
  },
  usageBasis: 'LOCAL_ESTIMATE',
  coverageReasons: ['UNREPORTED_PROVIDER_ATTEMPTS'],
  provenance: {
    models: ['gemini-3.1-flash'],
    regions: ['asia-south1'],
    promptVersions: ['ASR_V1'],
    pricingVersion: null,
    configurationVersion: null,
  },
};
describe('durable session-usage wire contract', () => {
  it('strictly discriminates registration and cumulative receipts', () => {
    expect(SessionUsageRegistrationSchema.parse(registration)).toEqual(registration);
    expect(SessionUsageCommandSchema.parse(registration).type).toBe('REGISTER');
    expect(SessionUsageReceiptSchema.parse(receipt)).toEqual(receipt);
    expect(SessionUsageCommandSchema.parse(receipt).type).toBe('RECEIPT');
  });
  it.each(['0', '0.1', '0.00000', '00.0000', '-1.0000', '1e2', '10000000000.0000'])(
    'refuses noncanonical/out-of-bounds monetary input %s',
    (value) => {
      expect(SessionUsageMoneySchema.safeParse(value).success).toBe(false);
    },
  );
  it('supports exact 4dp limits without floating point summation', () => {
    expect(SessionUsageMoneySchema.parse('9999999999.9999')).toBe('9999999999.9999');
    expect(
      SessionUsageReceiptSchema.safeParse({
        ...receipt,
        totals: { ...receipt.totals, costInr: '0.3001' },
      }).success,
    ).toBe(false);
  });
  it.each([{ text: 'clinical text' }, { audio: 'bytes' }, { serviceSecret: 'credential' }])(
    'rejects undeclared receipt fields',
    (extra) => {
      expect(SessionUsageReceiptSchema.safeParse({ ...receipt, ...extra }).success).toBe(false);
    },
  );
  it('requires terminal end time and explicit missing usage', () => {
    expect(
      SessionUsageReceiptSchema.safeParse({ ...receipt, state: 'FINAL_REPORTED' }).success,
    ).toBe(false);
    expect(
      SessionUsageReceiptSchema.safeParse({
        ...receipt,
        totals: { ...receipt.totals, unknownCalls: 1 },
      }).success,
    ).toBe(false);
    expect(
      SessionUsageReceiptSchema.safeParse({
        ...receipt,
        state: 'INCOMPLETE',
        endedAt: '2026-09-13T09:01:00.000Z',
        totals: { ...receipt.totals, unknownCalls: 1 },
        coverageReasons: ['MISSING_CALL_USAGE', 'INTERRUPTED'],
      }).success,
    ).toBe(true);
  });
  it('rejects false mock costs and unbounded/free-text provenance', () => {
    expect(
      SessionUsageReceiptSchema.safeParse({ ...receipt, usageBasis: 'MOCK_ZERO' }).success,
    ).toBe(false);
    expect(
      SessionUsageReceiptSchema.safeParse({
        ...receipt,
        provenance: { ...receipt.provenance, models: ['Patient says something'] },
      }).success,
    ).toBe(false);
    expect(
      SessionUsageReceiptSchema.safeParse({
        ...receipt,
        provenance: { ...receipt.provenance, models: Array(17).fill('model') },
      }).success,
    ).toBe(false);
  });
  it('canonicalizes nested key order into identical receipt hash input', () => {
    const parsed = SessionUsageCommandSchema.parse(receipt);
    const reordered = Object.fromEntries(Object.entries(parsed).reverse());
    expect(canonicalSessionUsagePayload(SessionUsageCommandSchema.parse(reordered))).toBe(
      canonicalSessionUsagePayload(parsed),
    );
    expect(canonicalSessionUsagePayload(parsed)).toContain('CUREOCITY_LIVE_USAGE_V1');
  });
  it('normalizes timestamps before hashing to match millisecond database storage', () => {
    const registered = SessionUsageRegistrationSchema.parse({
      ...registration,
      startedAt: '2026-09-13T09:00:00Z',
    });
    expect(registered.startedAt).toBe('2026-09-13T09:00:00.000Z');
    const terminal = SessionUsageReceiptSchema.parse({
      ...receipt,
      state: 'FINAL_REPORTED',
      endedAt: '2026-09-13T09:01:00.123456Z',
    });
    expect(terminal.endedAt).toBe('2026-09-13T09:01:00.123Z');
    const offset = SessionUsageReceiptSchema.parse({
      ...receipt,
      state: 'FINAL_REPORTED',
      endedAt: '2026-09-13T14:31:00+05:30',
    });
    expect(offset.endedAt).toBe('2026-09-13T09:01:00.000Z');
    expect(
      SessionUsageRegistrationSchema.parse({
        ...registration,
        connectionId: 'ABCDEFAB-ABCD-4ABC-8ABC-ABCDEFABCDEF',
      }).connectionId,
    ).toBe('abcdefab-abcd-4abc-8abc-abcdefabcdef');
  });
  it('strictly bounds acknowledgements and does not accept a different domain', () => {
    const ack = {
      version: 1,
      domain: identity.domain,
      connectionId: identity.connectionId,
      sessionId: identity.sessionId,
      acceptedSequence: 1,
      latestSequence: 1,
      status: 'ACCEPTED',
      payloadHash: 'a'.repeat(64),
    };
    expect(SessionUsageAckSchema.safeParse(ack).success).toBe(true);
    expect(SessionUsageAckSchema.safeParse({ ...ack, domain: 'OTHER' }).success).toBe(false);
    expect(SessionUsageAckSchema.safeParse({ ...ack, payloadHash: 'secret' }).success).toBe(false);
  });
  it('discloses unreported registration as null totals and excludes authentication/hash identifiers', () => {
    const exported = {
      sessionId: identity.sessionId,
      startedAt: registration.startedAt,
      registeredAt: registration.startedAt,
      updatedAt: registration.startedAt,
      endedAt: null,
      backend: 'vertex',
      state: 'OPEN',
      totals: null,
      usageBasis: null,
      coverageReasons: [],
      provenance: null,
    };
    expect(SessionUsageConnectionExportSchema.parse(exported).totals).toBeNull();
    expect(
      SessionUsageConnectionExportSchema.safeParse({ ...exported, lastPayloadHash: 'a'.repeat(64) })
        .success,
    ).toBe(false);
  });
});
