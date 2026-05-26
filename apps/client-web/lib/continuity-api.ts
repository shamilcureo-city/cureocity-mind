import type {
  CreateJournalEntryInput,
  CreateMoodLogInput,
  ExerciseAssignment,
  JournalEntry,
  MoodLog,
  NextSessionSummary,
} from '@cureocity/contracts';

const CONTINUITY_BASE =
  process.env.NEXT_PUBLIC_CONTINUITY_SERVICE_BASE ?? 'http://localhost:3005/api/v1';

async function http<T>(path: string, init: RequestInit & { idToken: string }): Promise<T> {
  const { idToken, headers, ...rest } = init;
  const res = await fetch(`${CONTINUITY_BASE}${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
      ...headers,
    },
  });
  if (!res.ok) {
    const text = await safeText(res);
    throw new Error(`${path} failed: ${res.status} ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

export const ContinuityApi = {
  exercises(idToken: string): Promise<ExerciseAssignment[]> {
    return http<ExerciseAssignment[]>('/me/exercises', { method: 'GET', idToken });
  },
  exercise(idToken: string, assignmentId: string): Promise<ExerciseAssignment> {
    return http<ExerciseAssignment>(`/me/exercises/${encodeURIComponent(assignmentId)}`, {
      method: 'GET',
      idToken,
    });
  },
  recordCompletion(
    idToken: string,
    assignmentId: string,
    response: Record<string, unknown>,
    notes?: string,
  ): Promise<ExerciseAssignment> {
    return http<ExerciseAssignment>(
      `/me/exercises/${encodeURIComponent(assignmentId)}/completions`,
      {
        method: 'POST',
        body: JSON.stringify({ response, ...(notes !== undefined && { notes }) }),
        idToken,
      },
    );
  },
  logMood(idToken: string, dto: CreateMoodLogInput): Promise<MoodLog> {
    return http<MoodLog>('/me/mood-logs', {
      method: 'POST',
      body: JSON.stringify(dto),
      idToken,
    });
  },
  listMoods(idToken: string, limit = 30): Promise<MoodLog[]> {
    return http<MoodLog[]>(`/me/mood-logs?limit=${limit}`, { method: 'GET', idToken });
  },
  createJournal(idToken: string, dto: CreateJournalEntryInput): Promise<JournalEntry> {
    return http<JournalEntry>('/me/journal-entries', {
      method: 'POST',
      body: JSON.stringify(dto),
      idToken,
    });
  },
  listJournals(idToken: string, limit = 30): Promise<JournalEntry[]> {
    return http<JournalEntry[]>(`/me/journal-entries?limit=${limit}`, {
      method: 'GET',
      idToken,
    });
  },
  nextSession(idToken: string): Promise<NextSessionSummary | null> {
    return http<NextSessionSummary | null>('/me/next-session', { method: 'GET', idToken });
  },
};
