import type { PersistedChunk } from './idb-chunk-store';

/** Keep failed bytes in memory until a committed storage write acknowledges them. */
export class AudioPersistenceQueue {
  private pending = new Map<number, PersistedChunk>();
  private inFlight: Promise<void> | null = null;

  constructor(private readonly write: (chunk: PersistedChunk) => Promise<void>) {}

  add(chunk: PersistedChunk): void {
    this.pending.set(chunk.chunkIndex, chunk);
  }

  get size(): number {
    return this.pending.size;
  }

  flush(): Promise<void> {
    if (this.inFlight) return this.inFlight.then(() => this.flush());
    const work = (async () => {
      for (const [index, chunk] of this.pending) {
        await this.write(chunk);
        this.pending.delete(index);
      }
    })();
    this.inFlight = work.finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }
}
