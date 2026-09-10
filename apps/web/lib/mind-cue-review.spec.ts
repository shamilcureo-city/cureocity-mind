import { describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import type { TherapyReasoningV1 } from '@cureocity/contracts';
import { captureViewElapsed } from './capture-view-clock';
import {
  cueFingerprints,
  cueReviewKey,
  MindCueReviewInputSchema,
  persistMindCueReview,
  readMindCueReview,
  reviewedCueIds,
  type MindCueReviewInput,
} from './mind-cue-review';

const input: MindCueReviewInput = {
  id: 'risk-live-example',
  kind: 'RED_FLAG',
  state: 'reviewed',
  fingerprint: 'a'.repeat(64),
  operationId: '0d9c2c4e-0434-4810-9f12-cb2e07c54c00',
  expectedRevision: null,
};
const updatedAt = '2026-09-09T10:00:00.000Z';
const receipt = { ...input, updatedAt };
delete (receipt as Partial<MindCueReviewInput>).expectedRevision;

describe('acknowledged Mind cue review', () => {
  it('requires a checked, matching HTTP receipt before reporting a saved review', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{"error":"failed"}', { status: 500 }));
    await expect(persistMindCueReview('s1', input, request)).rejects.toThrow(
      'could not be confirmed',
    );
    request.mockResolvedValue(
      new Response(
        JSON.stringify({ ...receipt, operationId: 'a626dfe7-62e0-48d6-bf8b-d29a2e75406e' }),
      ),
    );
    await expect(persistMindCueReview('s1', input, request)).rejects.toThrow(
      'receipt could not be verified',
    );
    request.mockResolvedValue(new Response(JSON.stringify(receipt)));
    await expect(persistMindCueReview('s1', input, request)).resolves.toMatchObject(receipt);
  });

  it('retries the same operation after an uncertain reply rather than inventing another mutation', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('network lost'))
      .mockResolvedValue(new Response(JSON.stringify(receipt)));
    await expect(persistMindCueReview('s1', input, request)).rejects.toThrow('network lost');
    await persistMindCueReview('s1', input, request);
    expect(request.mock.calls[0][1]?.body).toBe(request.mock.calls[1][1]?.body);
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).not.toHaveProperty('label');
  });

  it('does not confuse reviewing a cue with an assessment or allow client label logging', () => {
    expect(MindCueReviewInputSchema.safeParse({ ...input, label: 'clinical text' }).success).toBe(
      false,
    );
    expect(MindCueReviewInputSchema.safeParse({ ...input, state: 'assessed' }).success).toBe(false);
    expect(MindCueReviewInputSchema.safeParse({ ...input, fingerprint: 'unknown' }).success).toBe(
      false,
    );
  });

  it('only hides exact-current reviewed content; Undo and changed or missing evidence stay visible', () => {
    const key = cueReviewKey(input.kind, input.id);
    expect([...reviewedCueIds([receipt], { [key]: input.fingerprint })]).toEqual([key]);
    expect(reviewedCueIds([receipt], { [key]: 'b'.repeat(64) }).size).toBe(0);
    expect(reviewedCueIds([receipt], {}).size).toBe(0);
    expect(
      reviewedCueIds([{ ...receipt, state: 'reopened' }], { [key]: input.fingerprint }).size,
    ).toBe(0);
    // An ordinary question using the same opaque ID can never clear a risk.
    const keys = reviewedCueIds([{ ...receipt, kind: 'ASK_NEXT' }], {
      [key]: input.fingerprint,
      [cueReviewKey('ASK_NEXT', input.id)]: input.fingerprint,
    });
    expect(keys.has(key)).toBe(false);
    expect(keys.has(cueReviewKey('ASK_NEXT', input.id))).toBe(true);
  });

  it('binds marks to actual cue content, not a whole-snapshot version or an unchecked ID', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const reasoning: TherapyReasoningV1 = {
      version: 1,
      arc: null,
      askNext: [],
      threads: [],
      riskWatch: [
        {
          id: input.id,
          label: 'Fixture cue',
          why: 'Fixture explanation',
          source: 'LIVE',
          severity: 'high',
          sourceUtteranceIds: ['u1'],
        },
      ],
    };
    const baseline = await cueFingerprints(reasoning);
    expect(await cueFingerprints({ ...reasoning, version: 22 })).toEqual(baseline);
    expect(
      await cueFingerprints({
        ...reasoning,
        riskWatch: [{ ...reasoning.riskWatch[0]!, sourceUtteranceIds: ['u1', 'u2'] }],
      }),
    ).not.toEqual(baseline);
    expect(await cueFingerprints({ ...reasoning, riskWatch: [] })).toEqual({});
    vi.unstubAllGlobals();
  });

  it('reconstructs only explicit UI-review metadata, not legacy acted events', () => {
    expect(
      readMindCueReview({ suggestionId: input.id, kind: 'RED_FLAG' }, new Date(updatedAt)),
    ).toBeNull();
    expect(
      readMindCueReview(
        {
          mindCueReviewVersion: 1,
          suggestionId: input.id,
          kind: input.kind,
          reviewState: input.state,
          operationId: input.operationId,
          fingerprint: input.fingerprint,
        },
        new Date(updatedAt),
      ),
    ).toEqual(receipt);
  });

  it('measures timestamp elapsed through backgrounding and breaks without counting timer callbacks', () => {
    expect(captureViewElapsed(null, 300_000)).toBe(0);
    expect(captureViewElapsed(10_000, 370_000)).toBe(360_000);
    expect(captureViewElapsed(10_000, 9_000)).toBe(0);
  });
});
