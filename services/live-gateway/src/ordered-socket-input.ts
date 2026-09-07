/** Socket authorization may resolve out of order. Apply accepted input in
 * arrival order so pause cannot overtake the audio immediately before it. */
export class OrderedSocketInput {
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;
  private disposed = false;
  constructor(
    private readonly onFailure: () => void,
    private readonly limit = 2048,
  ) {}

  enqueue(work: () => Promise<void>): void {
    if (this.disposed) return;
    if (++this.pending > this.limit) {
      this.dispose();
      this.onFailure();
      return;
    }
    this.tail = this.tail
      .then(async () => {
        if (!this.disposed) await work();
      })
      .catch(() => {
        this.dispose();
        this.onFailure();
      })
      .finally(() => {
        this.pending--;
      });
  }

  drain(): Promise<void> {
    return this.tail;
  }
  dispose(): void {
    this.disposed = true;
  }
}
