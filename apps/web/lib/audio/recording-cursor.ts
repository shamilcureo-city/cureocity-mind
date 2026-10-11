export async function getRecordingCursor(
  sessionId: string,
  base = '/api/v1',
  getAuthToken?: () => Promise<string | null>,
): Promise<number> {
  const token = await getAuthToken?.();
  const response = await fetch(`${base}/sessions/${encodeURIComponent(sessionId)}/audio-cursor`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
    ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
  });
  if (!response.ok)
    throw new Error('Could not verify previously saved audio. Keep capture off and retry.');
  const value: unknown = await response.json();
  const index =
    value && typeof value === 'object' && 'nextChunkIndex' in value ? value.nextChunkIndex : null;
  if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0)
    throw new Error('The saved recording position could not be verified.');
  return index;
}
