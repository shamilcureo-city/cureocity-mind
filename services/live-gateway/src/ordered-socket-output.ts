/** A bounded FIFO whose grants cover only events already waiting at drain head. */
export class OrderedSocketOutput<T> {
  private queued: T[] = [];
  private draining = false;
  private disposed = false;
  private pending = 0;

  constructor(
    private readonly consumeBatch: (batch: readonly T[]) => Promise<void>,
    private readonly onFailure: () => void,
    private readonly limit = 2048,
  ) {}

  enqueue(event: T): void {
    if (this.disposed) return;
    if (++this.pending > this.limit) {
      this.dispose();
      this.onFailure();
      return;
    }
    this.queued.push(event);
    if (!this.draining) {
      this.draining = true;
      // Coalesce synchronous transcript/utterance emissions, not future work.
      queueMicrotask(() => void this.drain());
    }
  }

  dispose(): void {
    this.disposed = true;
    this.queued = [];
  }

  private async drain(): Promise<void> {
    try {
      while (!this.disposed && this.queued.length) {
        const batch = this.queued;
        this.queued = [];
        await this.consumeBatch(batch);
        this.pending -= batch.length;
      }
    } catch {
      this.dispose();
      this.onFailure();
    } finally {
      this.draining = false;
    }
  }
}
