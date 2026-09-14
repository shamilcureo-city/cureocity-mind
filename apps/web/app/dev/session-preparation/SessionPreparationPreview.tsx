'use client';

import { useCallback, useRef, useState } from 'react';
import {
  SaveMindSessionPreparationInputSchema,
  type MindSessionPreparationResponse,
  type MindSessionPreparationSaveResponse,
} from '@cureocity/contracts';
import { SessionPreparationPanel } from '@/components/app/SessionPreparationPanel';
import { Button } from '@/components/ui/Button';

type Mode = 'normal' | 'delay' | 'lost';
const CLIENT = 'fictional-preparation-client';
const FIRST = 'fictional-morning-visit';
const SECOND = 'fictional-afternoon-visit';
const visit = (sessionId: string, scheduledAt: string): MindSessionPreparationResponse => ({
  sessionId,
  clientId: CLIENT,
  scheduledAt,
  status: 'SCHEDULED',
  preparation: null,
});

/** All records exist only inside this fixture's memory. This is not production validation. */
export function SessionPreparationPreview() {
  const records = useRef(
    new Map([
      [FIRST, visit(FIRST, '2026-09-13T04:30:00.000Z')],
      [SECOND, visit(SECOND, '2026-09-13T09:30:00.000Z')],
    ]),
  );
  const receipts = useRef(new Map<string, MindSessionPreparationSaveResponse>());
  const mode = useRef<Mode>('normal');
  const [selected, setSelected] = useState(FIRST);
  const [scenario, setScenario] = useState<Mode>('normal');
  const [pending, setPending] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [started, setStarted] = useState(false);
  const [message, setMessage] = useState('');

  const transport = useCallback<typeof fetch>(async (input, init) => {
    const url = String(input);
    const sessionId = url.match(/^\/api\/v1\/sessions\/([^/]+)\/preparation$/)?.[1];
    const current = sessionId ? records.current.get(sessionId) : null;
    if (!current) return Response.json({}, { status: 404 });
    if (init?.method !== 'POST') return Response.json(current);
    const parsed = SaveMindSessionPreparationInputSchema.safeParse(JSON.parse(String(init.body)));
    if (!parsed.success || parsed.data.expectedClientId !== CLIENT)
      return Response.json({}, { status: 400 });
    const packet = parsed.data;
    const key = `${current.sessionId}:${packet.operationId}`;
    const previous = receipts.current.get(key);
    if (previous)
      return Response.json({
        ...previous,
        status: current.status,
        currentRevision: current.preparation?.revision ?? previous.currentRevision,
        replayed: true,
      });
    if (
      current.status !== 'SCHEDULED' ||
      packet.expectedRevision !== (current.preparation?.revision ?? 0) ||
      Date.parse(packet.expectedScheduledAt) !== Date.parse(current.scheduledAt)
    )
      return Response.json({}, { status: 409 });
    if (mode.current === 'delay') await new Promise((resolve) => setTimeout(resolve, 1_800));
    const preparation: MindSessionPreparationSaveResponse['preparation'] = {
      id: `${current.sessionId}-revision-${packet.expectedRevision + 1}`,
      sessionId: current.sessionId,
      psychologistId: 'fictional-psychologist',
      revision: packet.expectedRevision + 1,
      operationId: packet.operationId,
      body: {
        version: 1,
        focus: packet.focus,
        source: 'CLINICIAN_WRITTEN',
        scheduledAt: packet.expectedScheduledAt,
      },
      createdAt: new Date().toISOString(),
    };
    const saved: MindSessionPreparationSaveResponse = {
      ...current,
      preparation,
      currentRevision: preparation.revision,
      replayed: false,
    };
    records.current.set(current.sessionId, { ...current, preparation });
    receipts.current.set(key, saved);
    if (mode.current === 'lost') {
      mode.current = 'normal';
      setScenario('normal');
      throw new Error('Fictional response loss after memory-only save');
    }
    return Response.json(saved);
  }, []);

  function select(sessionId: string) {
    if (pending) return;
    if (dirty && !window.confirm('Discard this fictional unsaved wording and switch visits?'))
      return;
    setSelected(sessionId);
    setStarted(records.current.get(sessionId)?.status !== 'SCHEDULED');
    setMessage('');
  }

  return (
    <main className="mind-workspace-shell min-h-screen bg-[var(--color-bg)] px-4 py-8 text-[var(--color-ink)] sm:px-8">
      <div className="mx-auto max-w-2xl space-y-6">
        <header className="space-y-2">
          <p className="text-sm text-[var(--color-accent)]">Mind · fictional local preview</p>
          <h1 className="font-serif text-3xl">Prepare once for this visit.</h1>
          <p className="text-sm leading-relaxed text-[var(--color-ink-2)]">
            Two visits for one fictional client on the same day. No account, microphone, database or
            paid AI is used. Refreshing resets these fictional records.
          </p>
        </header>
        <div className="space-y-4 rounded-2xl bg-[var(--color-surface)] p-4 sm:p-6">
          <div className="space-y-2">
            <p className="text-sm font-medium">Fictional Nila’s visits</p>
            <div
              className="flex flex-wrap gap-2"
              role="group"
              aria-label="Choose exact fictional visit"
            >
              <Button
                type="button"
                size="sm"
                variant={selected === FIRST ? 'primary' : 'secondary'}
                aria-pressed={selected === FIRST}
                disabled={pending}
                onClick={() => select(FIRST)}
              >
                10:00 am visit
              </Button>
              <Button
                type="button"
                size="sm"
                variant={selected === SECOND ? 'primary' : 'secondary'}
                aria-pressed={selected === SECOND}
                disabled={pending}
                onClick={() => select(SECOND)}
              >
                3:00 pm visit
              </Button>
            </div>
          </div>
          <SessionPreparationPanel
            sessionId={selected}
            clientId={CLIENT}
            clientName="Fictional Nila"
            readOnly={started}
            request={transport}
            onPendingChange={setPending}
            onDirtyChange={setDirty}
          />
          <div className="border-t border-[var(--color-line-soft)] pt-4">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={pending || started}
              onClick={() => {
                if (
                  dirty &&
                  !window.confirm('Continue without adopting the fictional unsaved wording?')
                )
                  return;
                const current = records.current.get(selected)!;
                records.current.set(selected, { ...current, status: 'IN_PROGRESS' });
                setStarted(true);
                setMessage(
                  'Fictional visit started. Preparation is now read-only; no recording was started.',
                );
              }}
            >
              Start fictional visit
            </Button>
            {message && (
              <p role="status" className="mt-2 text-sm leading-relaxed text-[var(--color-ink-2)]">
                {message}
              </p>
            )}
          </div>
        </div>
        <details className="rounded-xl border border-[var(--color-line-soft)] p-4">
          <summary className="cursor-pointer text-sm font-medium">
            Fictional connection checks
          </summary>
          <label className="mt-3 block text-sm" htmlFor="preparation-preview-mode">
            Next save response
          </label>
          <select
            id="preparation-preview-mode"
            className="mt-2 w-full rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-2 text-sm"
            disabled={pending}
            value={scenario}
            onChange={(event) => {
              const next = event.target.value as Mode;
              mode.current = next;
              setScenario(next);
            }}
          >
            <option value="normal">Normal acknowledgement</option>
            <option value="delay">Slow acknowledgement (1.8 seconds)</option>
            <option value="lost">Save succeeds; its first response is lost</option>
          </select>
          <p className="mt-2 text-xs leading-relaxed text-[var(--color-ink-3)]">
            The lost-response example confirms retry uses the same operation, without another
            record. These controls do not change production settings.
          </p>
        </details>
      </div>
    </main>
  );
}
