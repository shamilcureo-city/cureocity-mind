'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Clinic, MyClinicsResponse } from '@cureocity/contracts';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { FieldError, Input, Label } from '../ui/Field';

/**
 * Sprint 39 — clinic settings (Phase 1). Read your clinic(s) + members;
 * owners/admins can rename. Member management is Phase 2.
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

  if (loading) {
    return <p className="text-sm text-[var(--color-ink-3)]">Loading your clinic…</p>;
  }
  if (error) {
    return <p className="text-sm text-[var(--color-warn)]">{error}</p>;
  }

  return (
    <div className="space-y-6">
      {clinics.map((c) => (
        <ClinicBlock key={c.id} clinic={c} onRenamed={load} />
      ))}
    </div>
  );
}

function ClinicBlock({ clinic, onRenamed }: { clinic: Clinic; onRenamed: () => void }) {
  const canEdit = clinic.myRole === 'OWNER' || clinic.myRole === 'ADMIN';
  const [name, setName] = useState(clinic.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = useCallback(async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/v1/clinics/${clinic.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setSaved(true);
      onRenamed();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [clinic.id, name, onRenamed]);

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="font-serif text-xl">{clinic.name}</h2>
          <Badge tone={clinic.kind === 'SOLO' ? 'muted' : 'accent'}>
            {clinic.kind === 'SOLO' ? 'Solo practice' : 'Group clinic'}
          </Badge>
          <Badge tone="default">You: {clinic.myRole.toLowerCase()}</Badge>
        </div>
      </div>

      {canEdit && (
        <div className="mt-5 max-w-md">
          <Label htmlFor={`name-${clinic.id}`}>Clinic name</Label>
          <div className="flex items-center gap-2">
            <Input
              id={`name-${clinic.id}`}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setSaved(false);
              }}
              maxLength={160}
            />
            <Button
              onClick={() => void save()}
              disabled={busy || name.trim().length === 0 || name.trim() === clinic.name}
            >
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </div>
          {saved && <p className="mt-1.5 text-xs text-[var(--color-accent)]">Saved.</p>}
          <FieldError message={error} />
        </div>
      )}

      <div className="mt-6">
        <p className="mb-2 text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
          Members ({clinic.members.length})
        </p>
        <ul className="divide-y divide-[var(--color-line-soft)] rounded-xl border border-[var(--color-line-soft)]">
          {clinic.members.map((m) => (
            <li key={m.psychologistId} className="flex items-center justify-between px-4 py-3">
              <span className="text-sm text-[var(--color-ink)]">{m.fullName}</span>
              <Badge tone={m.role === 'OWNER' ? 'accent' : 'muted'}>{m.role.toLowerCase()}</Badge>
            </li>
          ))}
        </ul>
      </div>

      {clinic.kind === 'SOLO' && (
        <p className="mt-4 text-xs text-[var(--color-ink-3)]">
          Inviting other therapists into a shared clinic — with role-based access to a common
          client roster — is coming soon. For now each therapist&rsquo;s clients stay private to
          them.
        </p>
      )}
    </Card>
  );
}
