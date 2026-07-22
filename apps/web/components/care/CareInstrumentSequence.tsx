'use client';

import { useState } from 'react';
import type { InstrumentKey } from '@cureocity/clinical';
import { CareInstrumentForm } from './CareInstrumentForm';

/**
 * CP-B — administer a short ordered run of instruments (PHQ-9 + GAD-7) as one
 * flow, so a session captures both a depression and an anxiety reading. Each
 * form shows its own score; only the last hands off to onDone. A skip skips the
 * whole run (measurement stays soft-gated, never mandatory).
 */
export function CareInstrumentSequence({
  instrumentKeys,
  framing,
  onDone,
  onSkip,
}: {
  instrumentKeys: InstrumentKey[];
  framing: 'baseline' | 'review';
  onDone: () => void;
  onSkip?: () => void;
}) {
  const keys = instrumentKeys.length > 0 ? instrumentKeys : (['PHQ9'] as InstrumentKey[]);
  const [idx, setIdx] = useState(0);
  const clamped = Math.min(idx, keys.length - 1);
  const isLast = clamped >= keys.length - 1;
  const positionLabel =
    keys.length > 1
      ? `${framing === 'baseline' ? 'Your starting line' : 'Before your review'} · ${clamped + 1} of ${keys.length}`
      : undefined;

  return (
    <CareInstrumentForm
      key={keys[clamped]!}
      instrumentKey={keys[clamped]!}
      framing={framing}
      positionLabel={positionLabel}
      doneLabel={isLast ? undefined : 'Next set →'}
      onDone={() => (isLast ? onDone() : setIdx(clamped + 1))}
      onSkip={onSkip}
    />
  );
}
