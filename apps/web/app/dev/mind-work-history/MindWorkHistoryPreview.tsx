'use client';

import { useState } from 'react';
import { MindWorkHistory } from '@/components/app/MindWorkHistory';
import type { MindSessionWork } from '@cureocity/contracts';

const clientId = 'fictional-work-history';
const entry = (
  recordVersion: number,
  sessionId: string,
  date: string,
  workDone: string,
  clientResponse = '',
) => ({
  recordVersion,
  savedAt: `2026-09-${recordVersion > 25 ? '14' : '10'}T10:00:00.000Z`,
  work: {
    sessionId,
    scheduledAt: `${date}T09:00:00.000Z`,
    disposition: 'ADAPTED' as MindSessionWork['disposition'],
    workDone,
    clientResponse,
  },
});

/** Closed fixture: no network, client records, storage or paid model calls. */
export function MindWorkHistoryPreview() {
  const [scenario, setScenario] = useState<'history' | 'empty' | 'unavailable'>('history');
  const request: typeof fetch = async (input) => {
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname !== `/api/v1/clients/${clientId}/session-work-history`)
      throw new Error('Unsupported fictional request.');
    if (scenario === 'unavailable')
      return Response.json({ error: 'Fictional unavailable history.' }, { status: 503 });
    if (scenario === 'empty')
      return Response.json({
        clientId,
        snapshotVersion: 0,
        beforeVersion: null,
        nextBeforeVersion: null,
        entries: [],
        hasMore: false,
      });
    const beforeVersion = url.searchParams.has('beforeVersion')
      ? Number(url.searchParams.get('beforeVersion'))
      : null;
    if (beforeVersion === null)
      return Response.json({
        clientId,
        snapshotVersion: 75,
        beforeVersion,
        nextBeforeVersion: 51,
        hasMore: true,
        entries: [
          entry(
            70,
            'fictional-visit-1',
            '2026-09-01',
            'Corrected wording: explored the focus the fictional client chose. This example records adaptation, not a completed protocol.',
            'Fictional client preferred a shorter conversation.',
          ),
          entry(
            60,
            'fictional-visit-2',
            '2026-09-07',
            'Returned to the fictional client’s agreed focus. No change in symptoms is inferred.',
          ),
        ],
      });
    if (beforeVersion === 51)
      return Response.json({
        clientId,
        snapshotVersion: 75,
        beforeVersion,
        nextBeforeVersion: 26,
        hasMore: true,
        entries: [],
      });
    if (beforeVersion === 26)
      return Response.json({
        clientId,
        snapshotVersion: 75,
        beforeVersion,
        nextBeforeVersion: null,
        hasMore: false,
        entries: [
          entry(
            20,
            'fictional-visit-1',
            '2026-09-01',
            'Earlier saved wording: explored the selected focus.',
          ),
          entry(
            10,
            'fictional-visit-0',
            '2026-08-24',
            'Discussed what the fictional client wanted from the next visit.',
            'Not yet discussed.',
          ),
        ],
      });
    throw new Error('Unsupported fictional history cursor.');
  };
  return (
    <main className="mind-workspace-shell min-h-screen bg-[var(--color-bg)] p-5 text-[var(--color-ink)] sm:p-10">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="space-y-3">
          <h1 className="font-serif text-3xl sm:text-4xl">Work recorded across visits</h1>
          <p className="max-w-prose">
            Fictional local preview. No client records, recording, AI calls or saved changes.
            Source-visit links are fictional; use the disclosures to inspect this example.
          </p>
        </header>
        <label className="block space-y-2 text-sm font-medium">
          Preview scenario
          <select
            value={scenario}
            onChange={(event) => setScenario(event.target.value as typeof scenario)}
            className="ml-3 min-h-11 rounded-lg border bg-white px-3"
          >
            <option value="history">Several visits and a correction</option>
            <option value="empty">No work recorded</option>
            <option value="unavailable">History unavailable</option>
          </select>
        </label>
        <MindWorkHistory key={scenario} clientId={clientId} request={request} />
      </div>
    </main>
  );
}
