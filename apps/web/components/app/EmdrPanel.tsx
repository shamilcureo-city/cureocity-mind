'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type {
  EmdrTarget,
  ModalityStateWithHistory,
} from '@cureocity/contracts';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Input, Label, Textarea } from '../ui/Field';

interface Props {
  workflow: ModalityStateWithHistory;
  scribeBase?: string;
  onWorkflowChange: (next: ModalityStateWithHistory) => void;
}

/**
 * EMDR-specific block rendered inside <WorkflowSection /> when the
 * workflow's modality is EMDR. Three sub-cards:
 *   1. Preparation status — shows whether Phase 2 (Preparation) is
 *      complete; if not, offers a confirm button that posts to
 *      /emdr/preparation-complete.
 *   2. Targets list — one row per target with SUDS/VOC progress.
 *   3. Add-target form — collapsible; submits to /emdr/targets.
 */
export function EmdrPanel({ workflow, scribeBase = '/api/v1', onWorkflowChange }: Props) {
  const [targets, setTargets] = useState<EmdrTarget[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [addingOpen, setAddingOpen] = useState(false);

  const state = (workflow.state ?? {}) as Record<string, unknown>;
  const prepComplete = Boolean(state['preparationComplete']);

  const loadTargets = useCallback(async () => {
    try {
      const res = await fetch(`${scribeBase}/workflows/${workflow.id}/emdr/targets`);
      if (!res.ok) return;
      const body = (await res.json()) as { items: EmdrTarget[] };
      setTargets(body.items);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [scribeBase, workflow.id]);

  useEffect(() => {
    void loadTargets();
  }, [loadTargets]);

  const confirmPreparation = useCallback(async () => {
    setConfirming(true);
    setError(null);
    try {
      const res = await fetch(
        `${scribeBase}/workflows/${workflow.id}/emdr/preparation-complete`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            safePlaceInstalled: true,
            resourcesAdequate: true,
            dissociationScreened: true,
          }),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const updated = (await res.json()) as ModalityStateWithHistory;
      onWorkflowChange(updated);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setConfirming(false);
    }
  }, [scribeBase, workflow.id, onWorkflowChange]);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-6">
        <h4 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
          Phase 2 — Preparation
        </h4>
        {prepComplete ? (
          <p className="mt-3 text-sm text-[var(--color-ink-2)]">
            <Badge tone="accent">Complete</Badge> Safe place installed, resources
            adequate, dissociation screened. Transitions to assessment and beyond are
            unlocked.
          </p>
        ) : (
          <>
            <p className="mt-3 text-sm text-[var(--color-ink-2)]">
              Phase 3 (Assessment) and later phases are gated until preparation is
              confirmed. Confirm only when safe-place installation, resource development,
              and the dissociation screen are all complete.
            </p>
            <div className="mt-3">
              <Button onClick={confirmPreparation} disabled={confirming}>
                {confirming ? 'Confirming…' : 'Mark preparation complete'}
              </Button>
            </div>
          </>
        )}
      </div>

      <div className="rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-6">
        <header className="flex items-baseline justify-between gap-3">
          <h4 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
            Target memories
          </h4>
          <button
            type="button"
            onClick={() => setAddingOpen((v) => !v)}
            className="text-xs text-[var(--color-accent)] hover:underline"
          >
            {addingOpen ? 'Cancel' : '+ add target'}
          </button>
        </header>

        {addingOpen && (
          <AddTargetForm
            workflowId={workflow.id}
            scribeBase={scribeBase}
            onCreated={(t) => {
              setTargets((prev) => [t, ...prev]);
              setAddingOpen(false);
            }}
          />
        )}

        {targets.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--color-ink-3)]">
            No target memories identified yet. EMDR desensitization phases require at
            least one target.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {targets.map((t) => (
              <TargetRow
                key={t.id}
                target={t}
                workflowId={workflow.id}
                scribeBase={scribeBase}
                onChange={(updated) =>
                  setTargets((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
                }
              />
            ))}
          </ul>
        )}
      </div>

      {error && (
        <div className="rounded-2xl border border-[var(--color-warn-border)] bg-[var(--color-warn-bg)] p-4 text-sm text-[var(--color-warn)]">
          {error}
        </div>
      )}
    </div>
  );
}

function AddTargetForm({
  workflowId,
  scribeBase,
  onCreated,
}: {
  workflowId: string;
  scribeBase: string;
  onCreated: (t: EmdrTarget) => void;
}) {
  const [label, setLabel] = useState('');
  const [image, setImage] = useState('');
  const [nc, setNc] = useState('');
  const [pc, setPc] = useState('');
  const [emotion, setEmotion] = useState('');
  const [bodyLocation, setBodyLocation] = useState('');
  const [vocStart, setVocStart] = useState(1);
  const [sudsStart, setSudsStart] = useState(8);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    setSubmitting(true);
    try {
      const res = await fetch(`${scribeBase}/workflows/${workflowId}/emdr/targets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          label,
          image,
          negativeCognition: nc,
          positiveCognition: pc,
          emotion,
          bodyLocation,
          vocStart,
          sudsStart,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const created = (await res.json()) as EmdrTarget;
      onCreated(created);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 space-y-3 border-t border-[var(--color-line-soft)] pt-4">
      <div>
        <Label htmlFor="t-label">Label</Label>
        <Input
          id="t-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. car accident"
          required
        />
      </div>
      <div>
        <Label htmlFor="t-image">Image / memory description</Label>
        <Textarea
          id="t-image"
          rows={2}
          value={image}
          onChange={(e) => setImage(e.target.value)}
          placeholder="The specific moment that holds the most charge."
          required
        />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <Label htmlFor="t-nc">Negative cognition</Label>
          <Input
            id="t-nc"
            value={nc}
            onChange={(e) => setNc(e.target.value)}
            placeholder='e.g. "I am not safe"'
            required
          />
        </div>
        <div>
          <Label htmlFor="t-pc">Positive cognition</Label>
          <Input
            id="t-pc"
            value={pc}
            onChange={(e) => setPc(e.target.value)}
            placeholder='e.g. "I am safe now"'
            required
          />
        </div>
        <div>
          <Label htmlFor="t-emotion">Emotion</Label>
          <Input
            id="t-emotion"
            value={emotion}
            onChange={(e) => setEmotion(e.target.value)}
            placeholder="fear, shame, anger…"
            required
          />
        </div>
        <div>
          <Label htmlFor="t-body">Body location</Label>
          <Input
            id="t-body"
            value={bodyLocation}
            onChange={(e) => setBodyLocation(e.target.value)}
            placeholder="chest, throat, stomach…"
            required
          />
        </div>
        <div>
          <Label htmlFor="t-voc" hint="1 = false · 7 = true">
            VOC start
          </Label>
          <Input
            id="t-voc"
            type="number"
            min={1}
            max={7}
            value={vocStart}
            onChange={(e) => setVocStart(Number(e.target.value))}
            required
          />
        </div>
        <div>
          <Label htmlFor="t-suds" hint="0 = none · 10 = worst">
            SUDS start
          </Label>
          <Input
            id="t-suds"
            type="number"
            min={0}
            max={10}
            value={sudsStart}
            onChange={(e) => setSudsStart(Number(e.target.value))}
            required
          />
        </div>
      </div>
      {err && <p className="text-sm text-[var(--color-warn)]">{err}</p>}
      <div className="flex justify-end">
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Adding…' : 'Add target'}
        </Button>
      </div>
    </form>
  );
}

function TargetRow({
  target,
  workflowId,
  scribeBase,
  onChange,
}: {
  target: EmdrTarget;
  workflowId: string;
  scribeBase: string;
  onChange: (next: EmdrTarget) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [suds, setSuds] = useState<number>(target.sudsCurrent ?? target.sudsStart);
  const [voc, setVoc] = useState<number>(target.vocCurrent ?? target.vocStart);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(
        `${scribeBase}/workflows/${workflowId}/emdr/targets/${target.id}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sudsCurrent: suds, vocCurrent: voc }),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const updated = (await res.json()) as EmdrTarget;
      onChange(updated);
      setEditing(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const sudsNow = target.sudsCurrent ?? target.sudsStart;
  const vocNow = target.vocCurrent ?? target.vocStart;

  return (
    <li className="rounded-xl border border-[var(--color-line-soft)] bg-white p-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-[var(--color-ink)]">{target.label}</span>
        <Badge tone="muted">{target.status.replaceAll('_', ' ')}</Badge>
      </div>
      <p className="mt-1 text-xs text-[var(--color-ink-3)]">
        NC: {target.negativeCognition} · PC: {target.positiveCognition}
      </p>
      <div className="mt-2 flex items-center gap-4 text-xs text-[var(--color-ink-2)]">
        <span>
          SUDS {target.sudsStart} → <strong>{sudsNow}</strong>
        </span>
        <span>
          VOC {target.vocStart} → <strong>{vocNow}</strong>
        </span>
        <span>{target.bilateralSetsTotal} bilateral sets</span>
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          className="ml-auto text-[var(--color-accent)] hover:underline"
        >
          {editing ? 'cancel' : 'update'}
        </button>
      </div>
      {editing && (
        <div className="mt-3 flex items-end gap-3">
          <div>
            <Label htmlFor={`s-${target.id}`}>SUDS now</Label>
            <Input
              id={`s-${target.id}`}
              type="number"
              min={0}
              max={10}
              value={suds}
              onChange={(e) => setSuds(Number(e.target.value))}
              className="w-20"
            />
          </div>
          <div>
            <Label htmlFor={`v-${target.id}`}>VOC now</Label>
            <Input
              id={`v-${target.id}`}
              type="number"
              min={1}
              max={7}
              value={voc}
              onChange={(e) => setVoc(Number(e.target.value))}
              className="w-20"
            />
          </div>
          <Button onClick={save} disabled={saving} className="mb-[2px]">
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      )}
      {err && <p className="mt-2 text-xs text-[var(--color-warn)]">{err}</p>}
    </li>
  );
}
