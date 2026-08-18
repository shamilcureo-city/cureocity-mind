import { NextResponse } from 'next/server';

const TRANSACTION_CONFLICT_CODES = new Set(['P2034', '40P01', '40001']);

function hasTransactionConflictCode(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as Record<string, unknown>;
  if (typeof record.code === 'string' && TRANSACTION_CONFLICT_CODES.has(record.code)) return true;
  return hasTransactionConflictCode(record.meta) || hasTransactionConflictCode(record.cause);
}

/** Map database-level concurrency aborts without retrying transaction side effects. */
export function transactionConflictResponse(error: unknown): NextResponse | null {
  if (!hasTransactionConflictCode(error)) return null;
  return NextResponse.json(
    {
      error: 'The appointment or session changed concurrently; please refresh and try again.',
      code: 'LIFECYCLE_TRANSACTION_CONFLICT',
    },
    { status: 409 },
  );
}
