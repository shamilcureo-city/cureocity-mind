'use client';

import { useState } from 'react';
import { AbdmPushResultSchema } from '@cureocity/contracts';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Input, Label } from '../ui/Field';

/**
 * Sprint DV8 — the interoperability panel on the doctor encounter
 * workspace. Export the signed encounter as a FHIR R4 Bundle, or push the
 * prescription to the patient's ABDM PHR (after linking their ABHA). Both
 * require a signed medical note. See docs/DOCTOR_VERTICAL_SPRINTS.md DV8.
 */
export function EncounterInteropPanel({ sessionId }: { sessionId: string }) {
  const [abha, setAbha] = useState('');
  const [busy, setBusy] = useState<null | 'fhir' | 'abdm'>(null);
  const [error, setError] = useState<string | null>(null);
  const [pushed, setPushed] = useState<string | null>(null);

  async function downloadFhir(): Promise<void> {
    setBusy('fhir');
    setError(null);
    try {
      const res = await fetch(`/api/v1/sessions/${sessionId}/fhir`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Export failed (${res.status}).`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `encounter-${sessionId}.fhir.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function pushAbdm(): Promise<void> {
    setBusy('abdm');
    setError(null);
    setPushed(null);
    try {
      const res = await fetch(`/api/v1/sessions/${sessionId}/abdm/push`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(abha.trim() ? { abhaAddress: abha.trim() } : {}),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        [k: string]: unknown;
      };
      if (!res.ok) throw new Error(body.error ?? `Push failed (${res.status}).`);
      const parsed = AbdmPushResultSchema.safeParse(body);
      if (!parsed.success) throw new Error('Unexpected response from the push.');
      setPushed(
        `Pushed ${parsed.data.resourceCount} resources via ${parsed.data.provider}` +
          (parsed.data.phrReference ? ` · ref ${parsed.data.phrReference}` : ''),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="p-6">
      <h2 className="mb-1 font-serif text-xl">Interoperability · ABDM</h2>
      <p className="mb-4 text-xs text-[var(--color-ink-3)]">
        Export the signed encounter as FHIR R4, or push the prescription to the patient’s ABDM
        health record. Requires a signed note.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <Button variant="secondary" onClick={downloadFhir} disabled={busy !== null}>
          {busy === 'fhir' ? 'Exporting…' : 'Download FHIR'}
        </Button>
        <div className="min-w-[14rem] flex-1">
          <Label htmlFor="abha">Patient ABHA (to link + push)</Label>
          <Input
            id="abha"
            placeholder="handle@sbx or 14-digit number"
            value={abha}
            onChange={(e) => setAbha(e.target.value)}
          />
        </div>
        <Button onClick={pushAbdm} disabled={busy !== null}>
          {busy === 'abdm' ? 'Pushing…' : 'Push to ABDM PHR'}
        </Button>
      </div>
      {pushed && <p className="mt-3 text-sm text-[var(--color-accent)]">✓ {pushed}</p>}
      {error && <p className="mt-3 text-sm text-[var(--color-warn)]">{error}</p>}
    </Card>
  );
}
