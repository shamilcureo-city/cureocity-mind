import { RxPadV1Schema, type RxPadV1 } from '@cureocity/contracts';

export interface CanonicalSigningPayloadInput {
  sessionId: string;
  draftContentHashHex: string;
  note: unknown;
  edits: readonly unknown[];
  signedAt: string;
  safetyOverride: unknown | undefined;
  rxPad: unknown | null;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

/** Exact bytes WebAuthn signs; nulls are deliberate commitments, not omissions. */
export function canonicalSigningPayload(input: CanonicalSigningPayloadInput): string {
  return JSON.stringify(
    canonicalize({
      sessionId: input.sessionId,
      draftContentHashHex: input.draftContentHashHex,
      note: input.note,
      edits: input.edits,
      signedAt: input.signedAt,
      safetyOverride: input.safetyOverride ?? null,
      rxPad: input.rxPad,
    }),
  );
}

/** Stable JSON bytes used to identify the exact locked draft content. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/** Normalize the partial live pad exactly once on both client and server. */
export function canonicalSignedRxPad(value: unknown): RxPadV1 | null {
  const parsed = RxPadV1Schema.safeParse(value);
  if (!parsed.success) return null;
  return {
    ...parsed.data,
    meds: parsed.data.meds.filter((med) => med.status === 'confirmed'),
  };
}
