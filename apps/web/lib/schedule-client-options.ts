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
