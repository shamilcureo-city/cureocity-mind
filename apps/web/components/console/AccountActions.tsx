'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PsychologistRole, PsychologistStatus } from '@cureocity/contracts';

/**
 * PC2 — the account-detail action panel. Role grant/revoke, lifecycle
 * status, and trial-cap adjustment, each posting to an admin-gated route
 * that re-checks the role and writes an audit row. Self-actions are
 * disabled client-side (and refused server-side) to prevent lock-out.
 */
export function AccountActions({
  accountId,
  role,
  status,
  trialCap,
  isSelf,
}: {
  accountId: string;
  role: PsychologistRole;
  status: PsychologistStatus;
  trialCap: number;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [cap, setCap] = useState<number>(trialCap);

  async function call(
    label: string,
    url: string,
    method: 'POST' | 'PATCH',
    body: unknown,
    successMsg: string,
  ): Promise<void> {
    setBusy(label);
    setError(null);
    setOk(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Failed (${res.status})`);
      }
      setOk(successMsg);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const STATUS_OPTIONS: PsychologistStatus[] = [
    'ACTIVE',
    'PENDING_VERIFICATION',
    'SUSPENDED',
    'OFFBOARDED',
  ];

  return (
    <div className="space-y-5">
      {isSelf && (
        <p className="rounded-xl border border-[var(--color-warn)] bg-[var(--color-warn-soft)] px-3 py-2 text-xs text-[var(--color-warn)]">
          This is your own account — role and status controls are disabled to prevent lock-out.
        </p>
      )}

      {/* Role */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-3)]">
          Admin role
        </p>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-sm text-[var(--color-ink-2)]">
            Currently <b>{role === 'ADMIN' ? 'admin' : 'therapist'}</b>
          </span>
          <button
            type="button"
            disabled={isSelf || busy !== null}
            onClick={() =>
              void call(
                'role',
                `/api/v1/admin/accounts/${accountId}/role`,
                'POST',
                { role: role === 'ADMIN' ? 'THERAPIST' : 'ADMIN' },
                role === 'ADMIN' ? 'Admin revoked' : 'Admin granted',
              )
            }
            className="rounded-full border border-[var(--color-line)] bg-white px-4 py-1.5 text-sm font-medium text-[var(--color-ink)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] disabled:opacity-50"
          >
            {busy === 'role' ? '…' : role === 'ADMIN' ? 'Revoke admin' : 'Grant admin'}
          </button>
        </div>
      </div>

      {/* Status */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-3)]">
          Account status
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {STATUS_OPTIONS.map((s) => (
            <button
              key={s}
              type="button"
              disabled={isSelf || busy !== null || s === status}
              onClick={() =>
                void call(
                  `status-${s}`,
                  `/api/v1/admin/accounts/${accountId}/status`,
                  'POST',
                  { status: s },
                  `Status → ${s.replace(/_/g, ' ').toLowerCase()}`,
                )
              }
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-45 ${
                s === status
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                  : 'border-[var(--color-line)] bg-white text-[var(--color-ink-2)] hover:border-[var(--color-accent)]'
              }`}
            >
              {busy === `status-${s}` ? '…' : s.replace(/_/g, ' ').toLowerCase()}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-[var(--color-ink-3)]">
          Set <b>active</b> to verify a pending account. Suspend is a marker — it does not yet force
          sign-out.
        </p>
      </div>

      {/* Trial cap */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-3)]">
          Free-trial session cap
        </p>
        <div className="mt-2 flex items-center gap-2">
          <input
            type="number"
            min={0}
            max={1000}
            value={cap}
            onChange={(e) => setCap(Math.max(0, Math.min(1000, Number(e.target.value) || 0)))}
            className="w-24 rounded-full border border-[var(--color-line)] bg-white px-3 py-1.5 text-sm outline-none focus:border-[var(--color-accent)]"
          />
          <button
            type="button"
            disabled={busy !== null || cap === trialCap}
            onClick={() =>
              void call(
                'cap',
                `/api/v1/admin/accounts/${accountId}/trial-cap`,
                'PATCH',
                { cap },
                `Trial cap → ${cap}`,
              )
            }
            className="rounded-full border border-[var(--color-line)] bg-white px-4 py-1.5 text-sm font-medium hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] disabled:opacity-50"
          >
            {busy === 'cap' ? '…' : 'Save cap'}
          </button>
        </div>
        <p className="mt-1.5 text-[11px] text-[var(--color-ink-3)]">
          Extends the free runway without comping a paid tier. Was {trialCap}.
        </p>
      </div>

      {error && <p className="text-xs text-[var(--color-warn)]">{error}</p>}
      {ok && <p className="text-xs text-[var(--color-good,#0E7A4A)]">✓ {ok}</p>}
    </div>
  );
}
