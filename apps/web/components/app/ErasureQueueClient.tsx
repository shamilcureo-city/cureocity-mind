'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Label, Textarea } from '../ui/Field';

interface QueueRow {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'FULFILLED';
  reason: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolutionNotes: string | null;
  client: { id: string; fullName: string; status: string };
}

type FilterStatus = 'PENDING' | 'APPROVED' | 'ALL';

export function ErasureQueueClient() {
  const [filter, setFilter] = useState<FilterStatus>('PENDING');
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);
  const [notesFor, setNotesFor] = useState<string | null>(null);
  const [notes, setNotes] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filter === 'PENDING') params.set('status', 'PENDING');
      else if (filter === 'APPROVED') params.set('status', 'APPROVED');
      // ALL → no filter param → returns PENDING per default; pass all
      // statuses explicitly.
      if (filter === 'ALL') {
        ['PENDING', 'APPROVED', 'REJECTED', 'FULFILLED'].forEach((s) => params.append('status', s));
      }
      const res = await fetch(`/api/v1/admin/erasure-queue?${params}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const body = (await res.json()) as { items: QueueRow[] };
      setRows(body.items);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const resolve = useCallback(
    async (id: string, status: 'APPROVED' | 'REJECTED' | 'FULFILLED') => {
      setResolving(id);
      setError(null);
      try {
        const res = await fetch(`/api/v1/admin/erasure/${id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            status,
            ...(notesFor === id && notes ? { resolutionNotes: notes } : {}),
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        setNotesFor(null);
        setNotes('');
        await load();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setResolving(null);
      }
    },
    [load, notes, notesFor],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {(['PENDING', 'APPROVED', 'ALL'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFilter(s)}
            className={`rounded-full px-3 py-1.5 transition-colors ${
              filter === s
                ? 'bg-[var(--color-ink)] text-[var(--color-surface)]'
                : 'border border-[var(--color-line)] bg-white text-[var(--color-ink-2)] hover:border-[var(--color-ink-3)]'
            }`}
          >
            {s}
          </button>
        ))}
        <span className="text-xs text-[var(--color-ink-3)]">
          {loading ? 'Loading…' : `${rows.length} row${rows.length === 1 ? '' : 's'}`}
        </span>
      </div>

      {error && (
        <Card className="border-[var(--color-warn-border)] bg-[var(--color-warn-bg)] p-4 text-sm text-[var(--color-warn)]">
          {error}
        </Card>
      )}

      {rows.length === 0 && !loading && (
        <Card className="p-10 text-center">
          <p className="text-sm text-[var(--color-ink-2)]">
            No requests in this view. {filter === 'PENDING' && 'All current requests are resolved.'}
          </p>
        </Card>
      )}

      {rows.map((r) => {
        const ageDays = Math.floor(
          (Date.now() - new Date(r.createdAt).getTime()) / (24 * 60 * 60 * 1000),
        );
        const overdue = ageDays >= 25 && r.status === 'PENDING';
        const isExpanded = notesFor === r.id;
        return (
          <Card key={r.id} className="p-6">
            <header className="flex flex-wrap items-baseline justify-between gap-3">
              <div>
                <Link
                  href={`/app/clients/${r.client.id}`}
                  className="font-serif text-lg hover:underline"
                >
                  {r.client.fullName}
                </Link>
                <p className="mt-1 text-xs text-[var(--color-ink-3)]">
                  Filed {ageDays} day{ageDays === 1 ? '' : 's'} ago ·{' '}
                  {new Date(r.createdAt).toLocaleString('en-GB')}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {overdue && <Badge tone="warn">overdue</Badge>}
                <Badge tone={r.status === 'PENDING' ? 'warn' : 'accent'}>
                  {r.status.toLowerCase()}
                </Badge>
              </div>
            </header>

            {r.reason && (
              <p className="mt-3 rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] p-3 text-sm text-[var(--color-ink)]">
                <span className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
                  Client&apos;s reason:
                </span>
                <br />
                {r.reason}
              </p>
            )}

            {r.resolutionNotes && (
              <p className="mt-3 text-xs text-[var(--color-ink-2)]">
                <strong>Resolution note:</strong> {r.resolutionNotes}
              </p>
            )}

            {(r.status === 'PENDING' || r.status === 'APPROVED') && (
              <>
                {isExpanded && (
                  <div className="mt-4">
                    <Label htmlFor={`note-${r.id}`} hint="optional · 0–2000 chars">
                      Resolution note (visible in audit)
                    </Label>
                    <Textarea
                      id={`note-${r.id}`}
                      rows={2}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="e.g. Approved subject to clinical hold for 60 days per ongoing-care policy."
                    />
                  </div>
                )}
                <div className="mt-4 flex flex-wrap gap-2">
                  {r.status === 'PENDING' && (
                    <>
                      <Button
                        onClick={() => void resolve(r.id, 'FULFILLED')}
                        disabled={resolving === r.id}
                      >
                        Fulfil now (soft-delete)
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => void resolve(r.id, 'APPROVED')}
                        disabled={resolving === r.id}
                      >
                        Approve (hold)
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => void resolve(r.id, 'REJECTED')}
                        disabled={resolving === r.id}
                      >
                        Reject
                      </Button>
                    </>
                  )}
                  {r.status === 'APPROVED' && (
                    <Button
                      onClick={() => void resolve(r.id, 'FULFILLED')}
                      disabled={resolving === r.id}
                    >
                      Fulfil now (soft-delete)
                    </Button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setNotesFor(isExpanded ? null : r.id);
                      setNotes('');
                    }}
                    className="ml-auto text-xs text-[var(--color-accent)] hover:underline"
                  >
                    {isExpanded ? 'hide notes' : '+ add resolution note'}
                  </button>
                </div>
              </>
            )}
          </Card>
        );
      })}
    </div>
  );
}
