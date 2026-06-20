'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ChronicTrajectorySchema,
  type ChronicMeasureKey,
  type ChronicMeasureTrajectory,
} from '@cureocity/contracts';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Input, Label } from '../ui/Field';

/**
 * Sprint DV7 — the chronic-disease panel on the doctor patient page (the
 * moat). Shows the per-patient control trajectory (BP / HbA1c / FBS / LDL
 * / weight) with deterministic control + trend verdicts, lets the doctor
 * log a reading, and shares a plain-language progress report with the
 * patient. See docs/DOCTOR_VERTICAL.md §9.
 */
const MEASURE_OPTIONS: { key: ChronicMeasureKey; label: string; composite?: boolean }[] = [
  { key: 'BP', label: 'Blood pressure', composite: true },
  { key: 'HBA1C', label: 'HbA1c (%)' },
  { key: 'FBS', label: 'Fasting blood sugar (mg/dL)' },
  { key: 'LDL', label: 'LDL cholesterol (mg/dL)' },
  { key: 'WEIGHT', label: 'Weight (kg)' },
];

export function ChronicCarePanel({ clientId }: { clientId: string }) {
  const [measures, setMeasures] = useState<ChronicMeasureTrajectory[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/v1/clients/${clientId}/chronic`);
    if (res.ok) {
      const parsed = ChronicTrajectorySchema.safeParse(await res.json());
      if (parsed.success) setMeasures(parsed.data.measures);
    }
    setLoaded(true);
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function share(): Promise<void> {
    setSharing(true);
    setShareError(null);
    try {
      const res = await fetch('/api/v1/share', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clientId,
          channels: ['PORTAL_LINK'],
          artefact: { artefactType: 'CHRONIC_PROGRESS_REPORT', clientId },
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Could not create the report (${res.status}).`);
      }
      const data = (await res.json()) as { results: { portalUrl: string }[] };
      setShareUrl(data.results[0]?.portalUrl ?? null);
    } catch (e) {
      setShareError((e as Error).message);
    } finally {
      setSharing(false);
    }
  }

  if (!loaded) return null;

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
          Chronic care
        </h2>
        {measures.length > 0 &&
          (shareUrl ? (
            <a
              href={shareUrl}
              target="_blank"
              rel="noopener"
              className="text-sm text-[var(--color-accent)] underline"
            >
              Open the progress report ↗
            </a>
          ) : (
            <Button variant="secondary" onClick={share} disabled={sharing}>
              {sharing ? 'Creating…' : 'Share progress report'}
            </Button>
          ))}
      </div>
      {shareError && <p className="mb-2 text-sm text-[var(--color-warn)]">{shareError}</p>}

      {measures.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {measures.map((m) => (
            <MeasureCard key={m.measure} m={m} />
          ))}
        </div>
      )}

      <RecordReadingForm clientId={clientId} onRecorded={load} />
    </section>
  );
}

function MeasureCard({ m }: { m: ChronicMeasureTrajectory }) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-[var(--color-ink)]">{m.label}</p>
          <p className="text-2xl font-semibold text-[var(--color-ink)]">
            {m.latest?.display ?? '—'}{' '}
            <span className="text-sm font-normal text-[var(--color-ink-3)]">{m.unit}</span>
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          {m.control && <Badge tone={controlTone(m.control)}>{controlLabel(m.control)}</Badge>}
          {m.trend && (
            <span className="text-xs text-[var(--color-ink-2)]">{trendLabel(m.trend)}</span>
          )}
        </div>
      </div>
      {m.summary && <p className="mt-2 text-xs text-[var(--color-ink-3)]">{m.summary}</p>}
      <p className="mt-1 text-xs text-[var(--color-ink-3)]">Target: {m.targetText}</p>
      {m.series.length > 1 && (
        <p className="mt-2 truncate font-mono text-xs text-[var(--color-ink-3)]">
          {m.series.map((p) => p.display).join('  →  ')}
        </p>
      )}
    </Card>
  );
}

function RecordReadingForm({
  clientId,
  onRecorded,
}: {
  clientId: string;
  onRecorded: () => Promise<void>;
}) {
  const [measure, setMeasure] = useState<ChronicMeasureKey>('HBA1C');
  const [value, setValue] = useState('');
  const [secondary, setSecondary] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isBp = measure === 'BP';

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/clients/${clientId}/readings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          measure,
          value: Number(value),
          ...(isBp && secondary !== '' && { valueSecondary: Number(secondary) }),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Could not save (${res.status}).`);
      }
      setValue('');
      setSecondary('');
      await onRecorded();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-4 p-5">
      <h3 className="mb-3 text-sm font-medium text-[var(--color-ink)]">Record a reading</h3>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="measure">Measure</Label>
          <select
            id="measure"
            value={measure}
            onChange={(e) => setMeasure(e.target.value as ChronicMeasureKey)}
            className="rounded-xl border border-[var(--color-line)] bg-white px-4 py-3 text-[15px] text-[var(--color-ink)]"
          >
            {MEASURE_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="w-28">
          <Label htmlFor="value">{isBp ? 'Systolic' : 'Value'}</Label>
          <Input
            id="value"
            type="number"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        {isBp && (
          <div className="w-28">
            <Label htmlFor="secondary">Diastolic</Label>
            <Input
              id="secondary"
              type="number"
              value={secondary}
              onChange={(e) => setSecondary(e.target.value)}
            />
          </div>
        )}
        <Button onClick={submit} disabled={busy || value === ''}>
          {busy ? 'Saving…' : 'Add'}
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-[var(--color-warn)]">{error}</p>}
    </Card>
  );
}

function controlTone(c: 'controlled' | 'borderline' | 'uncontrolled'): 'accent' | 'muted' | 'warn' {
  return c === 'controlled' ? 'accent' : c === 'uncontrolled' ? 'warn' : 'muted';
}
function controlLabel(c: 'controlled' | 'borderline' | 'uncontrolled'): string {
  return c === 'controlled'
    ? '✓ Controlled'
    : c === 'uncontrolled'
      ? '⚠ Uncontrolled'
      : 'Borderline';
}
function trendLabel(t: 'improving' | 'stable' | 'worsening'): string {
  return t === 'improving' ? '↓ improving' : t === 'worsening' ? '↑ worsening' : '→ steady';
}
