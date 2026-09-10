/** One local scratch intention per client and IST calendar day. Legacy keys are not imported. */
export function prepareIntentKey(clientId: string, now = new Date()): string {
  const day = new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
  return `prepare-intent-v2-${clientId}-${day}`;
}
