/** Only known product destinations are allowed; no user-provided redirect URL. */
export function clientCreationEntry(search: { new?: string; returnTo?: string; capture?: string }) {
  return {
    initiallyOpen: search.new === '1',
    returnToSession: search.returnTo === 'session',
    captureMode: search.capture === 'BATCH' ? ('BATCH' as const) : ('LIVE' as const),
  };
}

export function createdClientDestination(clientId: string, captureMode: 'LIVE' | 'BATCH'): string {
  return `/app/encounters/new?${new URLSearchParams({ record: clientId, capture: captureMode }).toString()}`;
}

export function newWalkInClientHref(captureMode: 'LIVE' | 'BATCH'): string {
  return `/app/clients?${new URLSearchParams({ new: '1', returnTo: 'session', capture: captureMode }).toString()}`;
}
