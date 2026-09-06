import { isFinalizedMindNote } from '@/components/app/MindTodayProgress';

export function clientSessionSummary(
  status: string,
  note: { locked: boolean; signedAt: Date | string } | null,
  draft: { status: string } | null,
): string {
  if (isFinalizedMindNote(note)) return 'Signed note';
  if (note) return 'Reopened — needs signature';
  if (draft?.status === 'COMPLETED') return 'Unsigned draft';
  if (draft?.status === 'IN_PROGRESS') return 'Generating note…';
  if (draft?.status === 'FAILED') return 'Note generation failed';
  if (draft?.status === 'PENDING') return 'Note generation pending';
  if (status === 'IN_PROGRESS') return 'Session in progress';
  if (status === 'SCHEDULED') return 'Upcoming appointment';
  return '—';
}
