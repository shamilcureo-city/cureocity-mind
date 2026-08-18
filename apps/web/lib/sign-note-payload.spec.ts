import { describe, expect, it } from 'vitest';
import { canonicalJson, canonicalSignedRxPad, canonicalSigningPayload } from './sign-note-payload';

describe('canonical signing payload', () => {
  it('commits to session, draft content, validated note, edits, time, override, and exact null Rx', () => {
    expect(
      canonicalSigningPayload({
        sessionId: 'session-1',
        draftContentHashHex: 'a'.repeat(64),
        note: { version: 'V1', z: 'last', a: 'first' },
        edits: [{ field: 'plan', before: 'old', after: 'new' }],
        signedAt: '2026-08-18T12:00:00.000Z',
        safetyOverride: undefined,
        rxPad: null,
      }),
    ).toBe(
      '{"draftContentHashHex":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","edits":[{"after":"new","before":"old","field":"plan"}],"note":{"a":"first","version":"V1","z":"last"},"rxPad":null,"safetyOverride":null,"sessionId":"session-1","signedAt":"2026-08-18T12:00:00.000Z"}',
    );
  });

  it('canonicalizes nested Rx and override objects independent of insertion order', () => {
    const common = {
      sessionId: 'session-1',
      draftContentHashHex: 'b'.repeat(64),
      note: { version: 'V1' },
      edits: [],
      signedAt: '2026-08-18T12:00:00.000Z',
    };
    const left = canonicalSigningPayload({
      ...common,
      safetyOverride: { reason: 'needed', blockers: ['allergy'] },
      rxPad: { meds: [{ status: 'confirmed', drug: 'A' }], adviceLines: ['rest'] },
    });
    const right = canonicalSigningPayload({
      ...common,
      safetyOverride: { blockers: ['allergy'], reason: 'needed' },
      rxPad: { adviceLines: ['rest'], meds: [{ drug: 'A', status: 'confirmed' }] },
    });

    expect(left).toBe(right);
  });

  it('sorts object keys by locale-independent UTF-16 code units', () => {
    expect(canonicalJson({ ä: 1, a: 2, Z: 3, A: 4 })).toBe('{"A":4,"Z":3,"a":2,"ä":1}');
  });

  it('normalizes a partial draft Rx identically and excludes unconfirmed medicines', () => {
    expect(
      canonicalSignedRxPad({
        meds: [
          { drug: 'A', status: 'confirmed' },
          { drug: 'B', status: 'pending' },
        ],
      }),
    ).toEqual({
      version: 'V1',
      dxLine: '',
      meds: [{ drug: 'A', continued: false, status: 'confirmed', warnings: [] }],
      investigations: [],
      adviceLines: [],
      allergies: [],
    });
    expect(canonicalSignedRxPad({ meds: 'malformed' })).toBeNull();
  });
});
