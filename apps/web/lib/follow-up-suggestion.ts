const IST_OFFSET_MS = (5 * 60 + 30) * 60_000;

export interface FollowUpSuggestion {
  cadenceDays: number;
  date: string;
  time: string;
}

export function suggestFollowUp(
  sessionAt: Date,
  cadenceDays = 7,
  now: Date = new Date(),
): FollowUpSuggestion {
  const ist = new Date(sessionAt.getTime() + IST_OFFSET_MS);
  ist.setUTCDate(ist.getUTCDate() + cadenceDays);
  while (ist.getTime() - IST_OFFSET_MS <= now.getTime()) {
    ist.setUTCDate(ist.getUTCDate() + cadenceDays);
  }
  return {
    cadenceDays,
    date: ist.toISOString().slice(0, 10),
    time: ist.toISOString().slice(11, 16),
  };
}
