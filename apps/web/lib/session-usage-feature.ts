/** Enable new reporting/UI only after the compatible schema and web API are installed. */
export function isSessionUsageEnabled(): boolean {
  return process.env.SESSION_USAGE_RECEIPTS_ENABLED === 'true';
}
