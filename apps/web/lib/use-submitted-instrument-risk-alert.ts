'use client';

import { useEffect, useRef } from 'react';
import type { MindInstrumentDraftState } from '@cureocity/contracts';

export interface SubmittedInstrumentRiskAlert {
  instrumentKey: string;
  itemNumber: number | null;
}

/** A lost submit reply or page reload must not hide the submitted safety flag.
 * Remember receipt IDs only in memory: dismissing is respected for this mount,
 * while a new page load surfaces the persisted receipt again. Starting another
 * draft, or saving an unflagged instrument, cannot clear an existing warning. */
export function useSubmittedInstrumentRiskAlert(
  clientId: string,
  receipt: MindInstrumentDraftState | null,
  notify: (alert: SubmittedInstrumentRiskAlert) => void,
) {
  const seen = useRef(new Set<string>());
  useEffect(() => {
    if (receipt?.status !== 'SUBMITTED' || !receipt.riskFlagged || !receipt.submittedResponseId)
      return;
    const identity = `${clientId}:${receipt.submittedResponseId}`;
    if (seen.current.has(identity)) return;
    seen.current.add(identity);
    notify({
      instrumentKey: receipt.instrumentKey,
      itemNumber: receipt.instrumentKey === 'PHQ9' ? 9 : null,
    });
  }, [clientId, receipt, notify]);
}
