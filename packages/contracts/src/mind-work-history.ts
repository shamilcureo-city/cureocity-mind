import { z } from 'zod';
import { MindSessionWorkSchema } from './mind-care-record';

export const MIND_WORK_HISTORY_PAGE_SIZE = 25;
const Version = z.number().int().positive().max(2_147_483_647);
const QueryVersion = z.coerce.number().int().positive().max(2_147_483_647);

export const MindWorkHistoryQuerySchema = z
  .object({ snapshotVersion: QueryVersion.optional(), beforeVersion: QueryVersion.optional() })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.snapshotVersion === undefined) !== (value.beforeVersion === undefined))
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Both history cursors are required.' });
    if (
      value.snapshotVersion !== undefined &&
      value.beforeVersion !== undefined &&
      value.beforeVersion > value.snapshotVersion
    )
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid history cursor order.' });
  });
export type MindWorkHistoryQuery = z.infer<typeof MindWorkHistoryQuerySchema>;

/** A change in clinician-authored work, not a copied-forward care-record snapshot. */
export const MindWorkHistoryEntrySchema = z
  .object({
    recordVersion: Version,
    savedAt: z.string().datetime(),
    work: MindSessionWorkSchema,
  })
  .strict();
export type MindWorkHistoryEntry = z.infer<typeof MindWorkHistoryEntrySchema>;

export const MindWorkHistoryPageSchema = z
  .object({
    clientId: z.string().min(1).max(200),
    snapshotVersion: z.number().int().nonnegative().max(2_147_483_647),
    beforeVersion: Version.nullable(),
    nextBeforeVersion: Version.nullable(),
    entries: z.array(MindWorkHistoryEntrySchema).max(MIND_WORK_HISTORY_PAGE_SIZE),
    hasMore: z.boolean(),
  })
  .strict()
  .superRefine((page, ctx) => {
    const invalid = () =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Inconsistent history page.' });
    if (page.beforeVersion !== null && page.beforeVersion > page.snapshotVersion) invalid();
    const firstVersion =
      page.beforeVersion === null ? page.snapshotVersion : page.beforeVersion - 1;
    const expectedNext =
      firstVersion > MIND_WORK_HISTORY_PAGE_SIZE
        ? firstVersion - MIND_WORK_HISTORY_PAGE_SIZE + 1
        : null;
    if (page.nextBeforeVersion !== expectedNext || page.hasMore !== (expectedNext !== null))
      invalid();
    let previous = firstVersion + 1;
    const lowestVersion = Math.max(1, firstVersion - MIND_WORK_HISTORY_PAGE_SIZE + 1);
    for (const entry of page.entries) {
      if (entry.recordVersion >= previous || entry.recordVersion < lowestVersion) invalid();
      previous = entry.recordVersion;
    }
  });
export type MindWorkHistoryPage = z.infer<typeof MindWorkHistoryPageSchema>;
