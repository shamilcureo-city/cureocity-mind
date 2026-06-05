'use client';

import { useCallback, useState, type FormEvent } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Label, Textarea } from '../ui/Field';

interface Props {
  clientId: string;
  clientName: string;
}

/**
 * Therapist-facing DPDP Data Rights surface. Therapist acts on
 * behalf of the client to fulfil rights received via email / phone /
 * in-person until the client-web PWA ships and clients can self-
 * serve. Each action audits as the appropriate DSR_* verb.
 *
 * V1 scope:
 *   - Data export (download JSON) — most-used in pilots
 *   - File erasure request (creates PENDING ClientErasureRequest row)
 *
 * Deferred to follow-ups: nomination form, correction form, consent
 * withdrawal toggle, grievance form. Their routes already exist so
 * the operator can curl them when an out-of-band request lands.
 */
export function DataRightsCard({ clientId, clientName }: Props) {
  const [exporting, setExporting] = useState(false);
  const [erasureOpen, setErasureOpen] = useState(false);
  const [erasureReason, setErasureReason] = useState('');
  const [erasurePending, setErasurePending] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);

  const exportData = useCallback(async () => {
    setExporting(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/v1/clients/${clientId}/dsr/data-export`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dsr-export-${clientId.slice(0, 8)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setMessage({ tone: 'ok', text: 'Export downloaded.' });
    } catch (e) {
      setMessage({ tone: 'warn', text: (e as Error).message });
    } finally {
      setExporting(false);
    }
  }, [clientId]);

  const fileErasure = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setErasurePending(true);
      setMessage(null);
      try {
        const res = await fetch(`/api/v1/clients/${clientId}/dsr/erasure`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ reason: erasureReason || undefined }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        setMessage({
          tone: 'ok',
          text: 'Erasure request filed. Admin review will follow per DPDP timelines.',
        });
        setErasureOpen(false);
        setErasureReason('');
      } catch (err) {
        setMessage({ tone: 'warn', text: (err as Error).message });
      } finally {
        setErasurePending(false);
      }
    },
    [clientId, erasureReason],
  );

  return (
    <Card className="p-6">
      <h3 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
        Data rights (DPDP)
      </h3>
      <p className="mt-2 text-sm text-[var(--color-ink-2)]">
        Fulfil requests {clientName} makes under the DPDP Act. Every action audits as the
        appropriate DSR_* verb; nothing surfaces to the client unless you tell them.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={exportData} disabled={exporting}>
          {exporting ? 'Generating…' : 'Export client data'}
        </Button>
        <Button variant="secondary" onClick={() => setErasureOpen((v) => !v)}>
          {erasureOpen ? 'Cancel erasure request' : 'File erasure request'}
        </Button>
      </div>

      {erasureOpen && (
        <form onSubmit={fileErasure} className="mt-4 space-y-3">
          <div>
            <Label htmlFor="erasure-reason" hint="Optional · 0–2000 chars">
              Reason supplied by the client
            </Label>
            <Textarea
              id="erasure-reason"
              rows={3}
              value={erasureReason}
              onChange={(e) => setErasureReason(e.target.value)}
              placeholder="e.g. Client no longer wishes their data retained after discharge."
            />
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={erasurePending}>
              {erasurePending ? 'Filing…' : 'File erasure request'}
            </Button>
          </div>
        </form>
      )}

      {message && (
        <p
          className={`mt-4 text-sm ${
            message.tone === 'ok' ? 'text-[var(--color-ink-2)]' : 'text-[var(--color-warn)]'
          }`}
        >
          {message.text}
        </p>
      )}

      <p className="mt-4 text-[11px] text-[var(--color-ink-3)]">
        Correction, nomination, consent withdrawal, and grievance endpoints are live at{' '}
        <code className="font-mono">/api/v1/clients/{'{id}'}/dsr/*</code> — UI for those
        ships in a follow-up.
      </p>
    </Card>
  );
}
