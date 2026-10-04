import { z } from 'zod';
import type { ReceptionAction, ReceptionRequestView, ReceptionWorkspace } from './reception';

const receiptSchema: z.ZodType<ReceptionRequestView> = z.object({
  id: z.string().min(1),
  kind: z.enum(['BOOKING', 'CANCEL', 'RESCHEDULE', 'QUESTION']),
  status: z.enum(['NEW', 'BOOKED', 'DECLINED', 'RESOLVED']),
  patientName: z.string(),
  patientPhone: z.string(),
  patientEmail: z.string().nullable(),
  message: z.string(),
  desiredStartAt: z.string().datetime({ offset: true }).nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  appointmentId: z.string().nullable(),
  sessionId: z.string().nullable(),
  clientId: z.string().nullable(),
  events: z.array(
    z.object({
      id: z.string(),
      action: z.string(),
      createdAt: z.string().datetime({ offset: true }),
    }),
  ),
});

/** A successful HTTP code alone must not leave a stale request open for another action. */
export function parseReceptionActionReceipt(
  id: string,
  action: ReceptionAction,
  body: unknown,
): ReceptionRequestView | { erased: true } {
  const invalid = () =>
    new Error(
      'The update response could not be verified. Refresh to check the request before acting again.',
    );
  if (action.action === 'ERASE') {
    if (
      !z
        .object({ erased: z.literal(true) })
        .strict()
        .safeParse(body).success
    )
      throw invalid();
    return { erased: true };
  }
  const result = receiptSchema.safeParse(body);
  const status =
    action.action === 'APPROVE_BOOKING'
      ? 'BOOKED'
      : action.action === 'DECLINE'
        ? 'DECLINED'
        : 'RESOLVED';
  if (!result.success || result.data.id !== id || result.data.status !== status) throw invalid();
  if (
    action.action === 'APPROVE_BOOKING' &&
    (result.data.kind !== 'BOOKING' ||
      result.data.clientId !== action.clientId ||
      !result.data.appointmentId ||
      !result.data.sessionId)
  )
    throw invalid();
  return result.data;
}

export function reconcileReceptionReceipt(
  workspace: ReceptionWorkspace,
  id: string,
  receipt: ReceptionRequestView | { erased: true },
): ReceptionWorkspace {
  const previous = workspace.requests.find((item) => item.id === id);
  const removedFromPending =
    previous?.status === 'NEW' && ('erased' in receipt || receipt.status !== 'NEW');
  return {
    ...workspace,
    ...(workspace.pendingCount !== undefined && removedFromPending
      ? { pendingCount: Math.max(0, workspace.pendingCount - 1) }
      : {}),
    requests:
      'erased' in receipt
        ? workspace.requests.filter((item) => item.id !== id)
        : workspace.requests.map((item) => (item.id === id ? receipt : item)),
  };
}
