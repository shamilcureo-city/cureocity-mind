export const DEFAULT_SHARES_PER_HOUR_CAP = 30;

export function parseSharesPerHourCap(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_SHARES_PER_HOUR_CAP;
  const normalized = raw.trim();
  if (!/^\d+$/.test(normalized)) return DEFAULT_SHARES_PER_HOUR_CAP;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : DEFAULT_SHARES_PER_HOUR_CAP;
}
