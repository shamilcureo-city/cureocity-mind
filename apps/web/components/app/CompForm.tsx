'use client';

import { useState, type FormEvent } from 'react';
import { Card } from '../ui/Card';
import { Input, Label, Textarea, FieldError } from '../ui/Field';

/**
 * Sprint 56 ops — admin form for POST /api/v1/admin/comp.
 *
 * Defaults match the most common case: a founder-comp Premium / 12mo.
 * The 'before' / 'after' panel after a successful comp helps the
 * operator sanity-check that they didn't overwrite a legitimate paid
 * plan by accident.
 */
interface CompResult {
  psychologistId: string;
  fullName: string;
  email: string;
  phone: string;
  before: { plan: string; status: string; paidThroughAt: string | null } | null;
  after: { plan: string; status: string; paidThroughAt: string };
}

const TIERS = ['TRAINEE', 'STARTER', 'PRO', 'PREMIUM'] as const;

export function CompForm() {
  const [phone, setPhone] = useState('+91');
  const [tier, setTier] = useState<(typeof TIERS)[number]>('PREMIUM');
  const [months, setMonths] = useState(12);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CompResult | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/v1/admin/comp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim(), tier, months, reason: reason.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as Partial<CompResult> & {
        error?: string;
      };
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      setResult(body as CompResult);
      setReason('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
      <Card className="p-6">
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <Label
              htmlFor="comp-phone"
              hint="E.164 — usually +91 + 10 digits for Indian therapists"
            >
              Phone
            </Label>
            <Input
              id="comp-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+917025840227"
              required
            />
          </div>

          <div>
            <Label htmlFor="comp-tier">Tier</Label>
            <select
              id="comp-tier"
              value={tier}
              onChange={(e) => setTier(e.target.value as (typeof TIERS)[number])}
              className="block w-full rounded-xl border border-[var(--color-line)] bg-white px-3 py-2 text-sm"
            >
              {TIERS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label htmlFor="comp-months" hint="1–120 months (30-day periods)">
              Months
            </Label>
            <Input
              id="comp-months"
              type="number"
              min={1}
              max={120}
              value={months}
              onChange={(e) => setMonths(Number(e.target.value))}
              required
            />
          </div>

          <div>
            <Label htmlFor="comp-reason" hint="Recorded on the audit row (3–500 chars).">
              Reason
            </Label>
            <Textarea
              id="comp-reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Founder comp"
              required
            />
          </div>

          {error && <FieldError message={error} />}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={busy || reason.trim().length < 3}
              className="rounded-full bg-[var(--color-accent)] px-5 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-60"
            >
              {busy ? 'Comping…' : 'Comp account'}
            </button>
            <p className="text-xs text-[var(--color-ink-3)]">
              Idempotent · re-running refreshes paidThroughAt.
            </p>
          </div>
        </form>
      </Card>

      <Card className="p-6">
        <h2 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">Result</h2>
        {!result && (
          <p className="mt-3 text-sm text-[var(--color-ink-3)]">
            Run a comp to see the before / after summary here.
          </p>
        )}
        {result && (
          <div className="mt-3 space-y-3 text-sm">
            <div>
              <p className="font-medium">{result.fullName}</p>
              <p className="text-xs text-[var(--color-ink-3)]">
                {result.email} · {result.phone}
              </p>
              <p className="text-xs text-[var(--color-ink-3)]">id {result.psychologistId}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-[var(--color-ink-3)]">Before</p>
              {result.before ? (
                <ul className="mt-1 space-y-0.5 font-mono text-xs">
                  <li>plan: {result.before.plan}</li>
                  <li>status: {result.before.status}</li>
                  <li>paidThroughAt: {result.before.paidThroughAt ?? 'null'}</li>
                </ul>
              ) : (
                <p className="mt-1 text-xs">No BillingAccount existed — created one.</p>
              )}
            </div>
            <div>
              <p className="text-xs uppercase text-[var(--color-ink-3)]">After</p>
              <ul className="mt-1 space-y-0.5 font-mono text-xs">
                <li>plan: {result.after.plan}</li>
                <li>status: {result.after.status}</li>
                <li>paidThroughAt: {result.after.paidThroughAt}</li>
              </ul>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
