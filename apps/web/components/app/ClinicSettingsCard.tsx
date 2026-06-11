'use client';

import { useCallback, useEffect, useState } from 'react';
import type {
  Clinic,
  ClinicMemberMetrics,
  ClinicRole,
  MyClinicsResponse,
} from '@cureocity/contracts';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { FieldError, Input, Label } from '../ui/Field';

/**
 * Sprint 39 + 42 — clinic settings. Read your clinic(s) + members;
 * owners/admins can rename, manage members, view aggregate metrics, and
 * reassign a departing therapist's caseload. Visibility stays private —
 * admins never see client names or clinical content.
 */
export function ClinicSettingsCard() {
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/clinics/me');
      const data = (await res.json().catch(() => ({}))) as MyClinicsResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setClinics(data.clinics ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <p className="text-sm text-[var(--color-ink-3)]">Loading your clinic…</p>;
  if (error) return <p className="text-sm text-[var(--color-warn)]">{error}</p>;

  return (
    <div className="space-y-6">
      {clinics.map((c) => (
        <ClinicBlock key={c.id} clinic={c} onChanged={load} />
      ))}
    </div>
  );
}

const SECTION = 'mt-6 border-t border-[var(--color-line-soft)] pt-5';
const HEADING = 'mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-3)]';

function ClinicBlock({ clinic, onChanged }: { clinic: Clinic; onChanged: () => void }) {
  const isAdmin = clinic.myRole === 'OWNER' || clinic.myRole === 'ADMIN';
  const isOwner = clinic.myRole === 'OWNER';
  const [error, setError] = useState<string | null>(null);

  const call = useCallback(
    async (url: string, init: RequestInit, ok: () => void) => {
      setError(null);
      try {
        const res = await fetch(url, init);
        if (!res.ok) {
          const d = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(d.error ?? `HTTP ${res.status}`);
        }
        ok();
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [],
  );

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-serif text-xl">{clinic.name}</h2>
        <Badge tone={clinic.kind === 'SOLO' ? 'muted' : 'accent'}>
          {clinic.kind === 'SOLO' ? 'Solo practice' : 'Group clinic'}
        </Badge>
        <Badge tone="default">You: {clinic.myRole.toLowerCase()}</Badge>
      </div>

      {isAdmin && <RenameRow clinic={clinic} onChanged={onChanged} setError={setError} />}

      {/* Members */}
      <div className={SECTION}>
        <p className={HEADING}>Members ({clinic.members.length})</p>
        <ul className="divide-y divide-[var(--color-line-soft)] rounded-xl border border-[var(--color-line-soft)]">
          {clinic.members.map((m) => (
            <li key={m.psychologistId} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="text-sm text-[var(--color-ink)]">{m.fullName}</span>
              {isOwner ? (
                <select
                  value={m.role}
                  onChange={(e) =>
                    call(
                      `/api/v1/clinics/${clinic.id}/members/${m.psychologistId}`,
                      {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ role: e.target.value as ClinicRole }),
                      },
                      onChanged,
                    )
                  }
                  className="rounded-lg border border-[var(--color-line)] bg-white px-2 py-1 text-xs"
                >
                  <option value="OWNER">owner</option>
                  <option value="ADMIN">admin</option>
                  <option value="MEMBER">member</option>
                </select>
              ) : (
                <Badge tone={m.role === 'OWNER' ? 'accent' : 'muted'}>{m.role.toLowerCase()}</Badge>
              )}
              {isAdmin && (
                <button
                  onClick={() => {
                    if (confirm(`Remove ${m.fullName} from the clinic?`)) {
                      void call(
                        `/api/v1/clinics/${clinic.id}/members/${m.psychologistId}`,
                        { method: 'DELETE' },
                        onChanged,
                      );
                    }
                  }}
                  className="ml-auto text-xs text-[var(--color-warn)] hover:underline"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>

      {isAdmin && (
        <AddMemberRow clinicId={clinic.id} canGrantAdmin={isOwner} onChanged={onChanged} setError={setError} />
      )}
      {isAdmin && <MetricsSection clinicId={clinic.id} />}
      {isAdmin && clinic.members.length > 1 && (
        <ReassignSection clinic={clinic} onChanged={onChanged} setError={setError} />
      )}

      {clinic.kind === 'SOLO' && (
        <p className="mt-5 text-xs text-[var(--color-ink-3)]">
          Add a therapist&rsquo;s email below to turn this into a group clinic. Each therapist&rsquo;s
          clients stay private to them — membership is for shared admin, not shared records.
        </p>
      )}
      <FieldError message={error} />
    </Card>
  );
}

function RenameRow({
  clinic,
  onChanged,
  setError,
}: {
  clinic: Clinic;
  onChanged: () => void;
  setError: (e: string | null) => void;
}) {
  const [name, setName] = useState(clinic.name);
  const [busy, setBusy] = useState(false);
  return (
    <div className="mt-5 flex max-w-md items-end gap-2">
      <div className="flex-1">
        <Label htmlFor={`name-${clinic.id}`}>Clinic name</Label>
        <Input id={`name-${clinic.id}`} value={name} maxLength={160} onChange={(e) => setName(e.target.value)} />
      </div>
      <Button
        disabled={busy || name.trim().length === 0 || name.trim() === clinic.name}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const res = await fetch(`/api/v1/clinics/${clinic.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: name.trim() }),
            });
            if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'Failed');
            onChanged();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Saving…' : 'Save'}
      </Button>
    </div>
  );
}

function AddMemberRow({
  clinicId,
  canGrantAdmin,
  onChanged,
  setError,
}: {
  clinicId: string;
  canGrantAdmin: boolean;
  onChanged: () => void;
  setError: (e: string | null) => void;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<ClinicRole>('MEMBER');
  const [busy, setBusy] = useState(false);
  return (
    <div className={SECTION}>
      <p className={HEADING}>Add a member</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[220px] flex-1">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="therapist@email.com"
          />
        </div>
        {canGrantAdmin && (
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as ClinicRole)}
            className="h-12 rounded-xl border border-[var(--color-line)] bg-white px-3 text-sm"
          >
            <option value="MEMBER">member</option>
            <option value="ADMIN">admin</option>
          </select>
        )}
        <Button
          disabled={busy || email.trim().length === 0}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const res = await fetch(`/api/v1/clinics/${clinicId}/members`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: email.trim(), role }),
              });
              if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'Failed');
              setEmail('');
              onChanged();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Adding…' : 'Add'}
        </Button>
      </div>
      <p className="mt-1.5 text-xs text-[var(--color-ink-3)]">
        They must have signed up already. Adding them doesn&rsquo;t share any clients.
      </p>
    </div>
  );
}

function MetricsSection({ clinicId }: { clinicId: string }) {
  const [rows, setRows] = useState<ClinicMemberMetrics[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className={SECTION}>
      <div className="flex items-center justify-between">
        <p className={HEADING}>Clinic metrics</p>
        <button
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const res = await fetch(`/api/v1/clinics/${clinicId}/metrics`);
              const d = (await res.json().catch(() => ({}))) as {
                members?: ClinicMemberMetrics[];
                error?: string;
              };
              if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
              setRows(d.members ?? []);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          className="text-xs text-[var(--color-accent)] hover:underline"
        >
          {busy ? 'Loading…' : rows ? 'Refresh' : 'Load'}
        </button>
      </div>
      {error && <p className="text-xs text-[var(--color-warn)]">{error}</p>}
      {rows && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
              <th className="py-1 font-medium">Therapist</th>
              <th className="py-1 text-right font-medium">Active clients</th>
              <th className="py-1 text-right font-medium">Sessions (30d)</th>
              <th className="py-1 text-right font-medium">Lifetime</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.psychologistId} className="border-t border-[var(--color-line-soft)]">
                <td className="py-1.5">{r.fullName}</td>
                <td className="py-1.5 text-right">{r.activeClients}</td>
                <td className="py-1.5 text-right">{r.sessions30d}</td>
                <td className="py-1.5 text-right">{r.sessionsLifetime}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-1.5 text-xs text-[var(--color-ink-3)]">Counts only — no client names or content.</p>
    </div>
  );
}

function ReassignSection({
  clinic,
  onChanged,
  setError,
}: {
  clinic: Clinic;
  onChanged: () => void;
  setError: (e: string | null) => void;
}) {
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const memberName = (id: string) => clinic.members.find((m) => m.psychologistId === id)?.fullName ?? id;

  return (
    <div className={SECTION}>
      <p className={HEADING}>Reassign a caseload (therapist departure)</p>
      <div className="flex flex-wrap items-end gap-2">
        <MemberSelect label="From" value={fromId} onChange={setFromId} members={clinic.members} exclude={toId} />
        <MemberSelect label="To" value={toId} onChange={setToId} members={clinic.members} exclude={fromId} />
        <Button
          variant="secondary"
          disabled={busy || !fromId || !toId || fromId === toId}
          onClick={async () => {
            if (
              !confirm(
                `Move ALL of ${memberName(fromId)}'s clients to ${memberName(toId)}? This transfers full custody and history.`,
              )
            )
              return;
            setBusy(true);
            setError(null);
            setDone(null);
            try {
              const res = await fetch(`/api/v1/clinics/${clinic.id}/reassign`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fromPsychologistId: fromId, toPsychologistId: toId }),
              });
              const d = (await res.json().catch(() => ({}))) as { moved?: number; error?: string };
              if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
              setDone(`Moved ${d.moved ?? 0} client(s).`);
              setFromId('');
              setToId('');
              onChanged();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Moving…' : 'Reassign all'}
        </Button>
      </div>
      {done && <p className="mt-1.5 text-xs text-[var(--color-accent)]">{done}</p>}
      <p className="mt-1.5 text-xs text-[var(--color-ink-3)]">
        Moves the full caseload + history to another therapist. Past authorship (who signed each
        note) is preserved.
      </p>
    </div>
  );
}

function MemberSelect({
  label,
  value,
  onChange,
  members,
  exclude,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  members: Clinic['members'];
  exclude: string;
}) {
  return (
    <label className="text-xs text-[var(--color-ink-3)]">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 block h-11 rounded-xl border border-[var(--color-line)] bg-white px-3 text-sm text-[var(--color-ink)]"
      >
        <option value="">Select…</option>
        {members
          .filter((m) => m.psychologistId !== exclude)
          .map((m) => (
            <option key={m.psychologistId} value={m.psychologistId}>
              {m.fullName}
            </option>
          ))}
      </select>
    </label>
  );
}
