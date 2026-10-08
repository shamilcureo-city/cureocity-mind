import { describe, expect, it, vi } from 'vitest';
import {
  ScribeCaptureCheckpoint,
  extendsScribeCaptureRecovery,
  ScribeCaptureRecoverySchema,
  type ScribeCaptureRecovery,
} from './scribe-capture-recovery';

const first: ScribeCaptureRecovery = {
  version: 1,
  captureIncomplete: false,
  utterances: [
    { id: 'u1', speaker: 'patient', text: 'Fictional captured words.', tStartMs: 0, tEndMs: 1000 },
  ],
};
const second: ScribeCaptureRecovery = {
  ...first,
  utterances: [
    ...first.utterances,
    {
      ...first.utterances[0]!,
      id: 'u2',
      text: 'Second fictional turn.',
      tStartMs: 1000,
      tEndMs: 2000,
    },
  ],
};
const receipt = (count: number) =>
  Response.json({ saved: true, sessionId: 's1', utteranceCount: count });

describe('Scribe captured-word checkpoint', () => {
  it('validates bounded unique source and never permits shortening, rewriting, or clearing an incomplete marker', () => {
    expect(ScribeCaptureRecoverySchema.safeParse(first).success).toBe(true);
    expect(
      ScribeCaptureRecoverySchema.safeParse({
        ...first,
        utterances: [first.utterances[0], first.utterances[0]],
      }).success,
    ).toBe(false);
    expect(extendsScribeCaptureRecovery(first, second)).toBe(true);
    expect(extendsScribeCaptureRecovery(second, first)).toBe(false);
    expect(
      extendsScribeCaptureRecovery(first, {
        ...first,
        utterances: [{ ...first.utterances[0]!, text: 'Rewritten.' }],
      }),
    ).toBe(false);
    expect(extendsScribeCaptureRecovery({ ...first, captureIncomplete: true }, first)).toBe(false);
  });
  it('restores only a same-session validated server receipt', async () => {
    const onState = vi.fn();
    const fetch = vi.fn().mockResolvedValue(Response.json({ sessionId: 's1', recovery: first }));
    const checkpoint = new ScribeCaptureCheckpoint({
      sessionId: 's1',
      fetch,
      onState,
      onFailure: vi.fn(),
    });
    expect(await checkpoint.load()).toEqual(first);
    expect(onState).toHaveBeenLastCalledWith('saved');
    await checkpoint.append(first);
    expect(fetch).toHaveBeenCalledOnce();
    fetch.mockResolvedValue(Response.json({ sessionId: 'different', recovery: first }));
    await expect(checkpoint.load()).rejects.toThrow();
    expect(onState).toHaveBeenLastCalledWith('error');
  });
  it('serializes snapshots and saves newer words only after the earlier ACK', async () => {
    let acknowledge!: (response: Response) => void;
    const fetch = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            acknowledge = resolve;
          }),
      )
      .mockResolvedValue(receipt(2));
    const onState = vi.fn();
    const checkpoint = new ScribeCaptureCheckpoint({
      sessionId: 's1',
      fetch,
      onState,
      onFailure: vi.fn(),
    });
    const pending = checkpoint.append(first);
    void checkpoint.append(second);
    expect(fetch).toHaveBeenCalledOnce();
    expect(onState).toHaveBeenLastCalledWith('saving');
    acknowledge(receipt(1));
    await pending;
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetch.mock.calls[1]![1].body)).toEqual(second);
    expect(onState).toHaveBeenLastCalledWith('saved');
  });
  it('retains failed source for explicit retry and does not treat a wrong ACK as saved', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(receipt(999)).mockResolvedValueOnce(receipt(1));
    const onFailure = vi.fn();
    const onState = vi.fn();
    const checkpoint = new ScribeCaptureCheckpoint({ sessionId: 's1', fetch, onState, onFailure });
    await expect(checkpoint.append(first)).rejects.toThrow();
    expect(onFailure).toHaveBeenCalledOnce();
    expect(onState).toHaveBeenLastCalledWith('error');
    await checkpoint.flush();
    expect(JSON.parse(fetch.mock.calls[1]![1].body)).toEqual(first);
    expect(onState).toHaveBeenLastCalledWith('saved');
    checkpoint.close();
    await checkpoint.append(second);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
