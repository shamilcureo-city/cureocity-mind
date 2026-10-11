import { afterEach, describe, expect, it, vi } from 'vitest';
const store = vi.hoisted(() => ({ listForSession: vi.fn(), remove: vi.fn() }));
vi.mock('./idb-chunk-store', async (original) => ({
  ...(await original<typeof import('./idb-chunk-store')>()),
  ChunkStore: store,
}));
import { downloadPendingAudio } from './download-pending-audio';
import type { PersistedChunk } from './idb-chunk-store';
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('download unsaved audio', () => {
  const chunk = (index: number, bytes: number[]): PersistedChunk => ({
    sessionId: 'session-test',
    chunkIndex: index,
    bytes: new Uint8Array(bytes),
    mimeType: 'audio/pcm',
    sampleRate: 16000,
    durationMs: 100,
    enqueuedAt: 0,
    attempts: 0,
  });
  it('exports the conflicting second tab memory copy, not the first tab shared storage audio', async () => {
    vi.useFakeTimers();
    store.listForSession.mockResolvedValue([chunk(0, [1, 2])]);
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fixture');
    const anchor = { href: '', download: '', click: vi.fn() };
    vi.stubGlobal('document', { createElement: () => anchor });
    const memory = [chunk(0, [9, 8]), chunk(1, [7, 6])];
    await downloadPendingAudio('session-test', memory);
    expect([
      ...new Uint8Array((await (create.mock.calls[0]![0] as Blob).arrayBuffer()).slice(44)),
    ]).toEqual([9, 8, 7, 6]);
    expect(anchor.download).toContain('-this-tab-parts.wav');
    expect(store.remove).not.toHaveBeenCalled();
    expect(memory).toHaveLength(2);
  });
  it('exports otherwise unrecoverable memory-only bytes when browser storage fails', async () => {
    vi.useFakeTimers();
    store.listForSession.mockRejectedValue(new Error('storage unavailable'));
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fixture');
    vi.stubGlobal('document', { createElement: () => ({ click: vi.fn() }) });
    await downloadPendingAudio('session-test', [chunk(4, [5, 6])]);
    expect([
      ...new Uint8Array((await (create.mock.calls[0]![0] as Blob).arrayBuffer()).slice(44)),
    ]).toEqual([5, 6]);
  });
  it('exports ordered PCM as a WAV without acknowledging or removing pending chunks', async () => {
    vi.useFakeTimers();
    store.listForSession.mockResolvedValue([
      { chunkIndex: 8, bytes: new Uint8Array([3, 4]).buffer },
      { chunkIndex: 7, bytes: new Uint8Array([1, 2]).buffer },
    ]);
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fixture');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const anchor = { href: '', download: '', click: vi.fn() };
    vi.stubGlobal('document', { createElement: () => anchor });
    await downloadPendingAudio('session-test');
    const blob = create.mock.calls[0]![0] as Blob;
    const bytes = await blob.arrayBuffer();
    expect(blob.type).toBe('audio/wav');
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('RIFF');
    expect(new DataView(bytes).getUint32(40, true)).toBe(4);
    expect([...new Uint8Array(bytes.slice(44))]).toEqual([1, 2, 3, 4]);
    expect(anchor.download).toBe('unsaved-session-session-test-parts.wav');
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(store.remove).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(revoke).toHaveBeenCalledWith('blob:fixture');
  });
  it('does not create a false empty recording', async () => {
    store.listForSession.mockResolvedValue([]);
    await expect(downloadPendingAudio('session-test')).rejects.toThrow('No unsaved audio');
  });
});
