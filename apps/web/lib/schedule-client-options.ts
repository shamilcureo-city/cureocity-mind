export interface ScheduleClientOption {
  id: string;
  fullName: string;
  preferredModality: string | null;
}

export function addCreatedClientOption(
  options: ScheduleClientOption[],
  created: ScheduleClientOption,
): ScheduleClientOption[] {
  return [...options.filter((option) => option.id !== created.id), created];
}

/** Keep an explicitly selected, matching client visible even beyond the display limit. */
export function visibleScheduleClients(
  options: readonly ScheduleClientOption[],
  query: string,
  selectedId = '',
): ScheduleClientOption[] {
  const needle = query.trim().toLowerCase();
  const matching = options.filter((option) => option.fullName.toLowerCase().includes(needle));
  const visible = matching.slice(0, 30);
  const selected = matching.find((option) => option.id === selectedId);
  return selected && !visible.some((option) => option.id === selectedId)
    ? [selected, ...visible.slice(0, 29)]
    : visible;
}

export function scheduleSelectionAfterSearch(
  options: readonly ScheduleClientOption[],
  query: string,
  selectedId: string,
): string {
  return visibleScheduleClients(options, query, selectedId).some(
    (option) => option.id === selectedId,
  )
    ? selectedId
    : '';
}

export function requireScheduleClient(
  options: readonly ScheduleClientOption[],
  clientId: string,
  fixedClientId?: string,
): ScheduleClientOption {
  const selected = options.find((option) => option.id === clientId);
  if (!selected || (fixedClientId !== undefined && clientId !== fixedClientId)) {
    throw new Error('Choose the client for this appointment.');
  }
  return selected;
}

export interface ScheduleReceipt {
  id: string;
  clientId: string;
  scheduledAt: string;
}

/** A receipt always comes from the saved server row, including idempotent reuse. */
export function readScheduleReceipt(
  value: unknown,
  expectedClientId: string,
): ScheduleReceipt | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== 'string' ||
    !row.id ||
    row.clientId !== expectedClientId ||
    typeof row.scheduledAt !== 'string' ||
    !Number.isFinite(Date.parse(row.scheduledAt))
  )
    return null;
  return { id: row.id, clientId: expectedClientId, scheduledAt: row.scheduledAt };
}

export function scheduleTriggerDisabled(closeoutMode: boolean, outcome: string | null): boolean {
  return closeoutMode && outcome === 'scheduled';
}
