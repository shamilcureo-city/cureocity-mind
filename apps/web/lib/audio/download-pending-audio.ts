import { ChunkStore, sameAudioChunk, type PersistedChunk } from './idb-chunk-store';

/** Export only the unsaved PCM parts, without deleting or acknowledging them. */
export async function downloadPendingAudio(
  sessionId: string,
  memory: PersistedChunk[] = [],
): Promise<void> {
  const stored = await ChunkStore.listForSession(sessionId).catch((error: unknown) => {
    if (!memory.length) throw error;
    return [];
  });
  const byIndex = new Map(stored.map((chunk) => [chunk.chunkIndex, chunk]));
  const collision = memory.some((chunk) => {
    const previous = byIndex.get(chunk.chunkIndex);
    return previous && !sameAudioChunk(previous, chunk);
  });
  // Two devices/tabs may be different recordings. Never splice conflicting
  // speech together: export this tab's otherwise memory-only copy separately.
  if (collision) byIndex.clear();
  for (const chunk of memory) byIndex.set(chunk.chunkIndex, chunk);
  const chunks = [...byIndex.values()].sort((a, b) => a.chunkIndex - b.chunkIndex);
  if (!chunks.length) throw new Error('No unsaved audio parts are available in this browser.');
  const size = chunks.reduce((sum, chunk) => sum + chunk.bytes.byteLength, 0);
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const label = (at: number, value: string) =>
    [...value].forEach((char, i) => view.setUint8(at + i, char.charCodeAt(0)));
  label(0, 'RIFF');
  view.setUint32(4, 36 + size, true);
  label(8, 'WAVE');
  label(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  label(36, 'data');
  view.setUint32(40, size, true);
  const url = URL.createObjectURL(
    new Blob([header, ...chunks.map((chunk) => new Uint8Array(chunk.bytes))], {
      type: 'audio/wav',
    }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `unsaved-session-${sessionId}${collision ? '-this-tab' : ''}-parts.wav`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
