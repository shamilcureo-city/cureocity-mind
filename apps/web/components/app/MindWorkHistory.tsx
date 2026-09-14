'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import type { MindWorkHistoryEntry } from '@cureocity/contracts';
import { Button } from '../ui/Button';
import { formatMindWorkDate, MIND_WORK_LABELS } from '../../lib/mind-session-work';
import {
  appendMindWorkHistoryEntries,
  groupMindWorkHistory,
  loadMindWorkHistoryPage,
  MindWorkHistoryError,
  type MindWorkHistoryCursor,
  type MindWorkHistoryFailure,
} from '../../lib/mind-work-history-client';
import styles from './MindWorkHistory.module.css';

type Phase = 'idle' | 'loading' | 'loading-more' | 'retrying' | 'ready' | 'error';

export function MindWorkHistory({
  clientId,
  request,
}: {
  clientId: string;
  request?: typeof fetch;
}) {
  const [boundClient, setBoundClient] = useState(clientId);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [entries, setEntries] = useState<MindWorkHistoryEntry[]>([]);
  const [snapshotVersion, setSnapshotVersion] = useState<number | null>(null);
  const [nextCursor, setNextCursor] = useState<MindWorkHistoryCursor | null>(null);
  const [failure, setFailure] = useState<MindWorkHistoryFailure | null>(null);
  const [lastPageStatus, setLastPageStatus] = useState<string | null>(null);
  const pending = useRef(false);
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const currentClient = useRef(clientId);
  currentClient.current = clientId;
  const retryCursor = useRef<MindWorkHistoryCursor | null>(null);
  const progressSummary = useRef<HTMLParagraphElement>(null);
  const errorSummary = useRef<HTMLDivElement>(null);
  const currentOpen = useRef(open);
  currentOpen.current = open;
  const id = useId();
  const contextMatches = boundClient === clientId;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      sequence.current += 1;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (boundClient === clientId) return;
    sequence.current += 1;
    controller.current?.abort();
    pending.current = false;
    retryCursor.current = null;
    setEntries([]);
    setSnapshotVersion(null);
    setNextCursor(null);
    setFailure(null);
    setLastPageStatus(null);
    setPhase('idle');
    setOpen(false);
    setBoundClient(clientId);
  }, [clientId, boundClient]);

  async function load(cursor: MindWorkHistoryCursor | null, retry = false) {
    if (pending.current || !mounted.current || currentClient.current !== boundClient) return;
    pending.current = true;
    const reportCompletion = !!cursor || retry || phase !== 'idle';
    const token = ++sequence.current;
    const abort = new AbortController();
    controller.current?.abort();
    controller.current = abort;
    retryCursor.current = cursor;
    setFailure(null);
    setLastPageStatus(null);
    setPhase(retry ? 'retrying' : cursor ? 'loading-more' : 'loading');
    if (!cursor) {
      setEntries([]);
      setSnapshotVersion(null);
      setNextCursor(null);
    }
    try {
      const page = await loadMindWorkHistoryPage(
        { clientId: boundClient, cursor },
        { request, signal: abort.signal },
      );
      if (
        !mounted.current ||
        token !== sequence.current ||
        currentClient.current !== boundClient ||
        abort.signal.aborted
      )
        return;
      const updated = cursor ? appendMindWorkHistoryEntries(entries, page.entries) : page.entries;
      setEntries(updated);
      setSnapshotVersion(page.snapshotVersion);
      setNextCursor(
        page.hasMore
          ? { snapshotVersion: page.snapshotVersion, beforeVersion: page.nextBeforeVersion! }
          : null,
      );
      setPhase('ready');
      if (reportCompletion)
        setLastPageStatus(
          `${page.entries.length === 0 ? 'No additional work changes in this range.' : `${page.entries.length} saved work ${page.entries.length === 1 ? 'change loaded' : 'changes loaded'}.`} ${page.hasMore ? 'Earlier records remain.' : 'This snapshot has been fully loaded.'}`,
        );
      if (reportCompletion)
        requestAnimationFrame(() => {
          if (
            mounted.current &&
            currentOpen.current &&
            token === sequence.current &&
            currentClient.current === boundClient
          )
            progressSummary.current?.focus();
        });
    } catch (cause) {
      if (
        !mounted.current ||
        token !== sequence.current ||
        currentClient.current !== boundClient ||
        abort.signal.aborted
      )
        return;
      const kind = cause instanceof MindWorkHistoryError ? cause.kind : 'protocol';
      setFailure(kind);
      setPhase('error');
      // A network failure hides the previously validated page while retaining its
      // retry base in memory. Access loss, malformed replies and other failures purge it.
      if (kind !== 'network') {
        setEntries([]);
        setSnapshotVersion(null);
        setNextCursor(null);
        retryCursor.current = null;
      }
      requestAnimationFrame(() => {
        if (
          mounted.current &&
          currentOpen.current &&
          token === sequence.current &&
          currentClient.current === boundClient
        )
          errorSummary.current?.focus();
      });
    } finally {
      if (token === sequence.current) {
        pending.current = false;
        controller.current = null;
      }
    }
  }

  // Do not show the old client's content for even one render before effect cleanup.
  if (!contextMatches)
    return (
      <p className={styles.status} role="status">
        Changing client. Previous work history is hidden.
      </p>
    );
  const busy = phase === 'loading' || phase === 'loading-more' || phase === 'retrying';
  const showEntries = phase === 'ready' || phase === 'loading-more';
  const groups = showEntries ? groupMindWorkHistory(entries) : [];
  return (
    <section className={styles.history} aria-labelledby={`${id}-heading`}>
      <h3 id={`${id}-heading`}>
        <button
          type="button"
          className={styles.trigger}
          aria-expanded={open}
          aria-controls={`${id}-content`}
          onClick={() => {
            setOpen((previous) => !previous);
            if (!open && phase === 'idle') void load(null);
          }}
        >
          <strong>Work history</strong>
          <span>{open ? 'Hide' : 'Open'}</span>
        </button>
      </h3>
      <div id={`${id}-content`} hidden={!open}>
        <p className={styles.intro}>
          What a psychologist explicitly recorded, grouped by source visit. Most recently recorded
          changes first. This is not an attendance record or a measure of improvement. A scheduled
          date does not confirm attendance.
        </p>
        {busy && (
          <p role="status" className={styles.status}>
            {phase === 'retrying'
              ? 'Retrying recorded work…'
              : phase === 'loading-more'
                ? 'Loading earlier recorded work…'
                : 'Loading recorded work…'}
          </p>
        )}
        {phase === 'error' && (
          <div ref={errorSummary} tabIndex={-1} className={styles.error} role="alert">
            <p>
              {failure === 'access'
                ? 'Work history is unavailable for this client. No history is shown. Check your access before refreshing.'
                : failure === 'network'
                  ? 'The connection was interrupted. No history is shown. Retry the same page to continue.'
                  : 'Verified work history could not be loaded. No history is shown. Refresh to try again.'}
            </p>
          </div>
        )}
        {groups.length > 0 && (
          <ol className={styles.visits} aria-label="Recorded work by source visit">
            {groups.map((group) => (
              <li key={group.sessionId} className={styles.visit}>
                <h4>Visit scheduled {formatMindWorkDate(group.latest.work.scheduledAt)}</h4>
                <RecordedWork entry={group.latest} />
                <Link
                  className={styles.source}
                  href={`/app/sessions/${encodeURIComponent(group.sessionId)}?tab=note`}
                >
                  Open source visit
                </Link>
                {group.previous.length > 0 && (
                  <details className={styles.previous}>
                    <summary>Earlier saved wording ({group.previous.length})</summary>
                    <ol>
                      {group.previous.map((entry) => (
                        <li key={entry.recordVersion}>
                          <RecordedWork entry={entry} />
                          <p className={styles.saved}>
                            Visit scheduled {formatMindWorkDate(entry.work.scheduledAt)}
                          </p>
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
              </li>
            ))}
          </ol>
        )}
        {phase === 'ready' && entries.length === 0 && (
          <p className={styles.status}>
            {nextCursor
              ? 'No recorded work in this part of the history. Earlier records are still available.'
              : 'No confirmed session work was found in this history.'}
          </p>
        )}
        {phase === 'ready' && lastPageStatus && (
          <p ref={progressSummary} tabIndex={-1} role="status" className={styles.status}>
            {lastPageStatus}
          </p>
        )}
        {showEntries && snapshotVersion !== null && snapshotVersion > 0 && (
          <p className={styles.saved}>
            {nextCursor
              ? 'Earlier records remain to be loaded. '
              : 'This snapshot has been fully loaded. '}
            Saved changes through care-record version {snapshotVersion}. Refresh to check for newer
            records.
          </p>
        )}
        <div className={styles.actions}>
          {(phase === 'ready' || phase === 'loading-more') && nextCursor && (
            <Button variant="secondary" disabled={busy} onClick={() => void load(nextCursor)}>
              Load earlier records
            </Button>
          )}
          {((phase === 'error' && failure === 'network') || phase === 'retrying') && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void load(retryCursor.current, true)}
            >
              Retry same page
            </Button>
          )}
          {phase !== 'idle' && (
            <Button variant="ghost" disabled={busy} onClick={() => void load(null)}>
              Refresh history
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

function RecordedWork({ entry }: { entry: MindWorkHistoryEntry }) {
  return (
    <div className={styles.wording}>
      <p className={styles.disposition}>{MIND_WORK_LABELS[entry.work.disposition]}</p>
      <p>{entry.work.workDone}</p>
      <p>
        <strong>Client response:</strong>{' '}
        {entry.work.clientResponse || 'Not recorded; no response or improvement is inferred.'}
      </p>
      <p className={styles.saved}>
        Saved {formatMindWorkDate(entry.savedAt)} · care-record version {entry.recordVersion}
      </p>
    </div>
  );
}
