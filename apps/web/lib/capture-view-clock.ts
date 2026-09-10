/** UI elapsed time is not captured-audio duration or a clinical session record.
 * A timestamp survives background timer throttling; pauses/reconnects count.
 * Reopening the page intentionally starts a new view clock. */
export function captureViewElapsed(startedAt: number | null, now: number): number {
  return startedAt === null ? 0 : Math.max(0, now - startedAt);
}
