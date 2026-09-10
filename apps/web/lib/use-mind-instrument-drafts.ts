'use client';
import { useEffect, useMemo, useReducer } from 'react';
import { MindInstrumentDraftController } from './mind-instrument-draft-client';
import { useUnsavedWorkGuard } from './use-unsaved-work-guard';

export function useMindInstrumentDrafts(clientId: string, enabled: boolean) {
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const controller = useMemo(
    () =>
      new MindInstrumentDraftController(clientId, (url, options) => fetch(url, options), redraw),
    [clientId],
  );
  useEffect(() => {
    if (!enabled) return;
    void controller.load('PHQ9').catch(() => undefined);
    void controller.load('GAD7').catch(() => undefined);
  }, [controller, enabled]);
  const entries = [controller.entry('PHQ9'), controller.entry('GAD7')];
  useUnsavedWorkGuard(
    controller.hasUnsaved(),
    'Some questionnaire answers are not confirmed saved. Leaving now may lose them. Stay here to retry, or leave without those unsaved changes?',
    entries.some((entry) => entry.saving || entry.commandBusy),
  );
  return controller;
}
