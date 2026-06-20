'use client';

import { useCallback, useEffect, useState } from 'react';
import type { InviteCode } from '@cureocity/contracts';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { FieldError, Input, Label } from '../ui/Field';

/**
 * Sprint 37 — admin client for pilot invite codes. Lists, mints, and
 * revokes codes against /api/v1/admin/invite-codes.
 */
export function InviteCodesClient() {
  const [items, setItems] = useState<InviteCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [maxUses, setMaxUses] = useState('1');
  const [minting, setMinting] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/admin/invite-codes');
      const data = (await res.json().catch(() => ({}))) as { items?: InviteCode[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setItems(data.items ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const mint = useCallback(async () => {
    setMinting(true);
    setError(null);
    try {
      const n = Math.max(1, Math.min(500, parseInt(maxUses, 10) || 1));
      const res = await fetch('/api/v1/admin/invite-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(label.trim() ? { label: label.trim() } : {}), maxUses: n }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setLabel('');
      setMaxUses('1');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setMinting(false);
    }
  }, [label, maxUses, load]);

  const revoke = useCallback(
    async (id: string) => {
      setError(null);
      try {
        const res = await fetch(`/api/v1/admin/invite-codes/${id}`, { method: 'DELETE' });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }
        await load();
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [load],
  );

  const copy = useCallback((code: string) => {
    void navigator.clipboard?.writeText(code);
    setCopied(code);
    setTimeout(() => setCopied((c) => (c === code ? null : c)), 1500);
  }, []);

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <h2 className="font-serif text-lg">Mint a code</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_140px_auto] sm:items-end">
          <div>
            <Label htmlFor="label" hint="optional">
              Who it&rsquo;s for
            </Label>
            <Input
              id="label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Dr. Nair — Kochi"
            />
          </div>
          <div>
            <Label htmlFor="maxUses">Seats</Label>
            <Input
              id="maxUses"
              type="number"
              min={1}
              max={500}
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
            />
          </div>
          <Button onClick={() => void mint()} disabled={minting} size="lg">
            {minting ? 'Minting…' : 'Mint code'}
          </Button>
        </div>
        <FieldError message={error} />
      </Card>

      <Card className="p-0">
        <div className="flex items-center justify-between border-b border-[var(--color-line-soft)] px-6 py-4">
          <h2 className="font-serif text-lg">Codes</h2>
          <button
            onClick={() => void load()}
            className="text-xs text-[var(--color-ink-3)] underline hover:text-[var(--color-ink)]"
          >
            Refresh
          </button>
        </div>
        {loading ? (
          <p className="px-6 py-8 text-sm text-[var(--color-ink-3)]">Loading…</p>
        ) : items.length === 0 ? (
          <p className="px-6 py-8 text-sm text-[var(--color-ink-3)]">
            No codes yet. Mint one above.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--color-line-soft)]">
            {items.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 px-6 py-4">
                <button
                  onClick={() => copy(c.code)}
                  className="font-mono text-sm font-semibold tracking-wide text-[var(--color-ink)] hover:text-[var(--color-accent)]"
                  title="Click to copy"
                >
                  {c.code}
                </button>
                {copied === c.code && (
                  <span className="text-xs text-[var(--color-accent)]">copied</span>
                )}
                {c.active ? (
                  <Badge tone="accent">active</Badge>
                ) : c.revokedAt ? (
                  <Badge tone="muted">revoked</Badge>
                ) : (
                  <Badge tone="muted">used up</Badge>
                )}
                <span className="text-xs text-[var(--color-ink-3)]">
                  {c.usedCount}/{c.maxUses} used
                </span>
                {c.label && <span className="text-sm text-[var(--color-ink-2)]">· {c.label}</span>}
                <div className="ml-auto">
                  {!c.revokedAt && (
                    <button
                      onClick={() => void revoke(c.id)}
                      className="text-xs text-[var(--color-warn)] hover:underline"
                    >
                      Revoke
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
