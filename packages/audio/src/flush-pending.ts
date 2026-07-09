/**
 * FLOW-2 — retry-drain the pending audio-upload queue until it is empty (or the
 * attempts run out), so "End session" never generates a note from partial audio
 * when clinic Wi-Fi drops in the last minutes of a consult.
 *
 * Pure + injectable (drainOnce + sleep) so the retry policy is unit-tested
 * without a browser, IndexedDB, or real timers. `drainOnce` performs one drain
 * pass and returns how many chunks still remain; this loops with a delay until
 * that reaches 0 or `maxAttempts` is exhausted, reporting progress each pass.
 */
export interface FlushPendingOptions {
  /** Total drain passes including the first. Default 5. */
  maxAttempts?: number;
  /** Delay between passes, ms. Default 1500. */
  delayMs?: number;
  /** Injectable sleep (tests pass a synchronous stub). */
  sleep?: (ms: number) => Promise<void>;
  /** Called after every pass with the remaining count + 1-based attempt. */
  onProgress?: (remaining: number, attempt: number) => void;
}

export async function flushPendingWithRetries(
  drainOnce: () => Promise<number>,
  opts: FlushPendingOptions = {},
): Promise<number> {
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 5);
  const delayMs = opts.delayMs ?? 1_500;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let remaining = await drainOnce();
  let attempt = 1;
  opts.onProgress?.(remaining, attempt);

  while (remaining > 0 && attempt < maxAttempts) {
    await sleep(delayMs);
    remaining = await drainOnce();
    attempt += 1;
    opts.onProgress?.(remaining, attempt);
  }
  return remaining;
}
