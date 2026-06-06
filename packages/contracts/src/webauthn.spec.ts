import { describe, expect, it } from 'vitest';
import {
  Base64UrlSchema,
  BeginRegistrationInputSchema,
  FinishRegistrationInputSchema,
  WebAuthnCredentialSchema,
} from './webauthn';

describe('Base64UrlSchema', () => {
  it.each(['abc', 'AbCdEfGhIjKlMnOpQrStUv', '_-aZ09'])('accepts %s', (s) => {
    expect(Base64UrlSchema.safeParse(s).success).toBe(true);
  });

  it.each(['has spaces', 'AbC=', '!!', ''])('rejects %s', (s) => {
    expect(Base64UrlSchema.safeParse(s).success).toBe(false);
  });
});

describe('BeginRegistrationInputSchema', () => {
  it('accepts an empty body', () => {
    expect(BeginRegistrationInputSchema.safeParse(undefined).success).toBe(true);
    expect(BeginRegistrationInputSchema.safeParse({}).success).toBe(true);
  });

  it('accepts a body with a label', () => {
    expect(
      BeginRegistrationInputSchema.safeParse({ label: 'MacBook Touch ID' }).success,
    ).toBe(true);
  });

  it('rejects a label exceeding 80 chars', () => {
    expect(BeginRegistrationInputSchema.safeParse({ label: 'x'.repeat(81) }).success).toBe(
      false,
    );
  });
});

describe('FinishRegistrationInputSchema', () => {
  const valid = {
    ticket: 'eyJ4IjoxfQ.MAC',
    label: 'Touch ID',
    credentialId: 'AbCdEfGhIjKlMnOpQrStUv',
    publicKey: 'pubkeybytes',
    clientDataJSON: 'cdjbytes',
    attestationObject: 'attobytes',
    transports: ['internal' as const, 'hybrid' as const],
  };

  it('accepts a well-formed body', () => {
    expect(FinishRegistrationInputSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects a malformed credentialId', () => {
    expect(
      FinishRegistrationInputSchema.safeParse({ ...valid, credentialId: 'has spaces' }).success,
    ).toBe(false);
  });

  it('rejects an unknown transport value', () => {
    expect(
      FinishRegistrationInputSchema.safeParse({
        ...valid,
        transports: ['mind-control'],
      }).success,
    ).toBe(false);
  });

  it('defaults transports to empty array when omitted', () => {
    const { transports: _t, ...rest } = valid;
    void _t;
    const parsed = FinishRegistrationInputSchema.safeParse(rest);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.transports).toEqual([]);
  });
});

describe('WebAuthnCredentialSchema', () => {
  const cuid = 'c123456789012345678901234';
  const valid = {
    id: cuid,
    psychologistId: cuid,
    credentialId: 'AbCdEfGhIjKlMnOpQrStUv',
    publicKey: 'pubkeybytes',
    signCount: 7,
    transports: ['internal'],
    label: 'Touch ID',
    lastUsedAt: '2026-06-20T10:00:00.000Z',
    revokedAt: null,
    createdAt: '2026-06-01T10:00:00.000Z',
    updatedAt: '2026-06-20T10:00:00.000Z',
  };

  it('accepts a representative credential row', () => {
    expect(WebAuthnCredentialSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects a negative signCount', () => {
    expect(WebAuthnCredentialSchema.safeParse({ ...valid, signCount: -1 }).success).toBe(false);
  });
});
