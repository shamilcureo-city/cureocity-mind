'use client';

import { useState } from 'react';
import type { ShareArtefactRef } from '@cureocity/contracts';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { ShareModal } from './ShareModal';

interface Props {
  clientId: string;
  hasContactPhone: boolean;
  hasContactEmail: boolean;
}

const CHECKINS: { key: 'PHQ9' | 'GAD7'; label: string; blurb: string }[] = [
  { key: 'PHQ9', label: 'PHQ-9 · Depression', blurb: '9 questions · ~1 minute' },
  { key: 'GAD7', label: 'GAD-7 · Anxiety', blurb: '7 questions · ~1 minute' },
];

/**
 * Sprint 47 — send a self-serve check-in from the client record.
 *
 * Picks the instrument, then hands off to the existing ShareModal
 * (which already does channel selection, config greying, and the
 * POST /share fan-out). ShareModal is artefact-agnostic, so an
 * INSTRUMENT_CHECKIN artefact ref flows through unchanged.
 */
export function SendCheckinButton({ clientId, hasContactPhone, hasContactEmail }: Props) {
  const [picking, setPicking] = useState(false);
  const [artefact, setArtefact] = useState<ShareArtefactRef | null>(null);
  const [label, setLabel] = useState('');

  function choose(instrumentKey: 'PHQ9' | 'GAD7', lbl: string) {
    setArtefact({ artefactType: 'INSTRUMENT_CHECKIN', clientId, instrumentKey });
    setLabel(`Check-in · ${lbl}`);
    setPicking(false);
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setPicking(true)}>
        Send check-in
      </Button>

      {picking && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="checkin-pick-title"
          onClick={() => setPicking(false)}
        >
          <Card className="w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <header className="mb-4 flex items-baseline justify-between gap-3">
              <h2 id="checkin-pick-title" className="font-serif text-xl">
                Send a check-in
              </h2>
              <button
                type="button"
                onClick={() => setPicking(false)}
                className="text-sm text-[var(--color-ink-3)] hover:text-[var(--color-ink)]"
              >
                cancel
              </button>
            </header>
            <p className="mb-4 text-sm text-[var(--color-ink-2)]">
              The client fills this in on their phone from a private link. The score lands in their
              trend automatically.
            </p>
            <div className="space-y-2">
              {CHECKINS.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => choose(c.key, c.label)}
                  className="flex w-full items-center justify-between rounded-xl border border-[var(--color-line)] bg-white px-4 py-3 text-left transition-colors hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-soft)]"
                >
                  <span className="text-sm font-medium text-[var(--color-ink)]">{c.label}</span>
                  <span className="text-xs text-[var(--color-ink-3)]">{c.blurb}</span>
                </button>
              ))}
            </div>
          </Card>
        </div>
      )}

      {artefact && (
        <ShareModal
          open
          onClose={() => setArtefact(null)}
          clientId={clientId}
          hasContactPhone={hasContactPhone}
          hasContactEmail={hasContactEmail}
          artefact={artefact}
          artefactLabel={label}
        />
      )}
    </>
  );
}
