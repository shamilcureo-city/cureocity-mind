'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  SessionOrdersSchema,
  type ClinicalOrderDTO,
  type MedicationOrderDTO,
} from '@cureocity/contracts';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Input, Label } from '../ui/Field';

/**
 * Sprint DV5 — the Rx + orders panel on the doctor encounter workspace.
 *
 * The AI drafts medications + clinical orders from the consultation; the
 * doctor confirms each (optionally editing dose / frequency / duration)
 * or discards it. Drug interactions are flagged with a 💊 banner —
 * computed deterministically server-side. Nothing is auto-prescribed;
 * confirming is an explicit clinical act. See docs/DOCTOR_VERTICAL.md §6.
 */
export function EncounterOrdersPanel({ sessionId }: { sessionId: string }) {
  const [meds, setMeds] = useState<MedicationOrderDTO[]>([]);
  const [orders, setOrders] = useState<ClinicalOrderDTO[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/v1/sessions/${sessionId}/orders`);
    if (!res.ok) {
      setLoaded(true);
      return;
    }
    const parsed = SessionOrdersSchema.safeParse(await res.json());
    if (parsed.success) {
      setMeds(parsed.data.medications);
      setOrders(parsed.data.clinicalOrders);
    }
    setLoaded(true);
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!loaded || (meds.length === 0 && orders.length === 0)) return null;

  return (
    <div className="space-y-4">
      {meds.length > 0 && (
        <Card className="p-6">
          <h2 className="mb-1 font-serif text-xl">Prescription</h2>
          <p className="mb-4 text-xs text-[var(--color-ink-3)]">
            Drafted from the consultation. Confirm each line — nothing is prescribed until you do.
          </p>
          <ul className="space-y-3">
            {meds.map((m) => (
              <MedicationRow key={m.id} order={m} onChanged={load} />
            ))}
          </ul>
        </Card>
      )}

      {orders.length > 0 && (
        <Card className="p-6">
          <h2 className="mb-1 font-serif text-xl">Orders</h2>
          <p className="mb-4 text-xs text-[var(--color-ink-3)]">
            Labs, imaging, referrals and procedures drafted from the consultation.
          </p>
          <ul className="space-y-3">
            {orders.map((o) => (
              <ClinicalOrderRow key={o.id} order={o} onChanged={load} />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function MedicationRow({
  order,
  onChanged,
}: {
  order: MedicationOrderDTO;
  onChanged: () => Promise<void>;
}) {
  const c = order.content;
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dose, setDose] = useState(c.dose ?? '');
  const [frequency, setFrequency] = useState(c.frequency ?? '');
  const [durationDays, setDurationDays] = useState(c.durationDays ? String(c.durationDays) : '');

  async function update(
    status: 'CONFIRMED' | 'DISCARDED',
    edits?: Record<string, unknown>,
  ): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/medication-orders/${order.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status, ...(edits && { edits }) }),
      });
      if (!res.ok) throw new Error(`Update failed (${res.status}).`);
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const confirmed = order.status === 'CONFIRMED';
  const detail = [
    c.strength,
    c.dose,
    c.frequency,
    c.durationDays ? `× ${c.durationDays} days` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <li className="rounded-xl border border-[var(--color-line)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-[var(--color-ink)]">{c.drug}</p>
          {detail && <p className="text-sm text-[var(--color-ink-2)]">{detail}</p>}
          {c.instructions && (
            <p className="mt-0.5 text-xs text-[var(--color-ink-3)]">{c.instructions}</p>
          )}
        </div>
        {confirmed ? <Badge tone="accent">✓ Confirmed</Badge> : <Badge tone="muted">Draft</Badge>}
      </div>

      {c.interactionWarnings.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {c.interactionWarnings.map((w, i) => (
            <li
              key={i}
              className="rounded-lg border border-[var(--color-warn)] bg-[var(--color-warn-soft)] px-3 py-2 text-xs text-[var(--color-warn)]"
            >
              💊 {w}
            </li>
          ))}
        </ul>
      )}

      {editing && !confirmed && (
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div>
            <Label htmlFor={`dose-${order.id}`}>Dose</Label>
            <Input id={`dose-${order.id}`} value={dose} onChange={(e) => setDose(e.target.value)} />
          </div>
          <div>
            <Label htmlFor={`freq-${order.id}`}>Frequency</Label>
            <Input
              id={`freq-${order.id}`}
              value={frequency}
              onChange={(e) => setFrequency(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor={`dur-${order.id}`}>Duration (days)</Label>
            <Input
              id={`dur-${order.id}`}
              type="number"
              min={1}
              value={durationDays}
              onChange={(e) => setDurationDays(e.target.value)}
            />
          </div>
        </div>
      )}

      {!confirmed && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {editing ? (
            <Button
              onClick={() =>
                update('CONFIRMED', {
                  ...(dose !== '' && { dose }),
                  ...(frequency !== '' && { frequency }),
                  ...(durationDays !== '' && { durationDays: Number(durationDays) }),
                })
              }
              disabled={busy}
            >
              {busy ? 'Saving…' : 'Save & confirm'}
            </Button>
          ) : (
            <>
              <Button onClick={() => update('CONFIRMED')} disabled={busy}>
                {busy ? 'Confirming…' : 'Confirm'}
              </Button>
              <Button variant="ghost" onClick={() => setEditing(true)} disabled={busy}>
                Edit
              </Button>
            </>
          )}
          <Button variant="ghost" onClick={() => update('DISCARDED')} disabled={busy}>
            Discard
          </Button>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-[var(--color-warn)]">{error}</p>}
    </li>
  );
}

function ClinicalOrderRow({
  order,
  onChanged,
}: {
  order: ClinicalOrderDTO;
  onChanged: () => Promise<void>;
}) {
  const c = order.content;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmed = order.status === 'CONFIRMED';

  async function update(status: 'CONFIRMED' | 'DISCARDED'): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/clinical-orders/${order.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(`Update failed (${res.status}).`);
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-xl border border-[var(--color-line)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Badge tone="muted">{c.category}</Badge>
            <p className="font-medium text-[var(--color-ink)]">{c.description}</p>
          </div>
          {c.rationale && <p className="mt-0.5 text-xs text-[var(--color-ink-3)]">{c.rationale}</p>}
        </div>
        {confirmed ? (
          <Badge tone="accent">✓ Confirmed</Badge>
        ) : (
          <div className="flex items-center gap-2">
            <Button onClick={() => update('CONFIRMED')} disabled={busy}>
              {busy ? 'Confirming…' : 'Confirm'}
            </Button>
            <Button variant="ghost" onClick={() => update('DISCARDED')} disabled={busy}>
              Discard
            </Button>
          </div>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-[var(--color-warn)]">{error}</p>}
    </li>
  );
}
