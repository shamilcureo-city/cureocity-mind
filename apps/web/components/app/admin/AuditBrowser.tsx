'use client';

import { useCallback, useEffect, useState } from 'react';

interface AuditRow {
  id: string;
  action: string;
  actorType: string;
  actorEmail: string | null;
  targetType: string;
  targetId: string;
  metadata: unknown;
  createdAt: string;
}

const QUICK_ACTIONS: { label: string; action: string }[] = [
  { label: 'All', action: '' },
  { label: 'Admin ops', action: 'ADMIN_ROLE_GRANTED' },
  { label: 'Status changes', action: 'ADMIN_ACCOUNT_STATUS_CHANGED' },
  { label: 'Comps', action: 'PLAN_UPGRADED' },
  { label: 'Notes signed', action: 'SIGNED_NOTE' },
  { label: 'Erasures', action: 'DSR_ERASURE_FULFILLED' },
  { label: 'Crisis flags', action: 'CRISIS_FLAG_RAISED' },
];

/**
 * PC2 — audit browser. Filters over the append-only log via the admin-gated
 * GET /api/v1/admin/audit (which itself writes an ADMIN_AUDIT_LOG_READ row).
 * Newest first, capped at 200. Metadata is shown collapsed; it never
 * contains client PHI (audit writers store ids + before/after, not content).
 */
export function AuditBrowser() {
  const [action, setAction] = useState('');
  const [actorId, setActorId] = useState('');
  const [targetType, setTargetType] = useState('');
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (action) params.set('action', action);
      if (actorId.trim()) params.set('actorPsychologistId', actorId.trim());
      if (targetType.trim()) params.set('targetType', targetType.trim());
      const res = await fetch(`/api/v1/admin/audit?${params.toString()}`, { cache: 'no-store' });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Failed (${res.status})`);
      }
      const body = (await res.json()) as { rows: AuditRow[] };
      setRows(body.rows);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [action, actorId, targetType]);

  // Re-fetch when a quick-filter action chip changes. Keyed on `action`
  // only (not the text filters) so typing doesn't fire a request per
  // keystroke — the Search button calls load() explicitly. The repo's
  // ESLint doesn't run react-hooks/exhaustive-deps, so this is intentional
  // and lint-clean.
  useEffect(() => {
    void load();
  }, [action]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {QUICK_ACTIONS.map((q) => (
          <button
            key={q.label}
            type="button"
            onClick={() => setAction(q.action)}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              action === q.action
                ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                : 'border-[var(--color-line)] bg-white text-[var(--color-ink-2)] hover:border-[var(--color-accent)]'
            }`}
          >
            {q.label}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-xs text-[var(--color-ink-3)]">Action (exact)</label>
          <input
            type="text"
            value={action}
            onChange={(e) => setAction(e.target.value.toUpperCase())}
            placeholder="e.g. ENCOUNTER_NOTE_SIGNED"
            className="w-56 rounded-full border border-[var(--color-line)] bg-white px-3 py-1.5 text-sm outline-none focus:border-[var(--color-accent)]"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-[var(--color-ink-3)]">
            Actor psychologist id
          </label>
          <input
            type="text"
            value={actorId}
            onChange={(e) => setActorId(e.target.value)}
            placeholder="cmr…"
            className="w-56 rounded-full border border-[var(--color-line)] bg-white px-3 py-1.5 text-sm outline-none focus:border-[var(--color-accent)]"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-[var(--color-ink-3)]">Target type</label>
          <input
            type="text"
            value={targetType}
            onChange={(e) => setTargetType(e.target.value)}
            placeholder="Session, Psychologist…"
            className="w-44 rounded-full border border-[var(--color-line)] bg-white px-3 py-1.5 text-sm outline-none focus:border-[var(--color-accent)]"
          />
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="h-[34px] rounded-full bg-[var(--color-accent)] px-5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
        >
          {loading ? 'Loading…' : 'Search'}
        </button>
      </div>

      {error && <p className="mb-3 text-xs text-[var(--color-warn)]">{error}</p>}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-[var(--color-ink-3)]">
              <th className="pb-2 font-medium">Action</th>
              <th className="pb-2 font-medium">Actor</th>
              <th className="pb-2 font-medium">Target</th>
              <th className="pb-2 text-right font-medium">When</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading ? (
              <tr>
                <td colSpan={4} className="py-4 text-sm text-[var(--color-ink-3)]">
                  No matching audit rows.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.id}
                  className="cursor-pointer border-t border-[var(--color-line-soft)] align-top hover:bg-white/60"
                  onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                >
                  <td className="py-2.5">
                    <span className="font-mono text-xs">{r.action}</span>
                    {expanded === r.id && r.metadata != null && (
                      <pre className="mt-1.5 max-w-md overflow-x-auto rounded-lg bg-[var(--color-surface-soft)] p-2 text-[10px] leading-relaxed text-[var(--color-ink-2)]">
                        {JSON.stringify(r.metadata, null, 2)}
                      </pre>
                    )}
                  </td>
                  <td className="py-2.5 text-xs text-[var(--color-ink-2)]">
                    {r.actorEmail ?? r.actorType.toLowerCase()}
                  </td>
                  <td className="py-2.5 text-xs text-[var(--color-ink-3)]">
                    {r.targetType}
                    <span className="block font-mono text-[10px]">{r.targetId.slice(0, 14)}</span>
                  </td>
                  <td className="py-2.5 text-right text-xs text-[var(--color-ink-3)]">
                    {new Date(r.createdAt).toLocaleString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                      hour: 'numeric',
                      minute: '2-digit',
                      hour12: true,
                    })}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] text-[var(--color-ink-3)]">
        Rows are capped at 100, newest first. Tap a row to see its metadata. Every search you run is
        itself logged as <span className="font-mono">ADMIN_AUDIT_LOG_READ</span>.
      </p>
    </div>
  );
}
