'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { CARE_PERSONAS } from './personas';
import type { CareResource } from './SafetyStrip';

interface SettingsPayload {
  personaName: string;
  voiceName: string;
  personaStyle: string;
  vadSilenceMs: number;
  trustedContactName: string | null;
  trustedContactPhone: string | null;
  planTier: string;
  status: string;
  whatsappOptedIn: boolean;
  sessionDays: number[];
}

/**
 * Settings + the safety-resume check-in (AC6, S9). When the account is
 * on SAFETY_HOLD the check-in renders FIRST and full-width — sessions
 * stay locked until it passes (§2 layer 5).
 */
export function CareSettings({ resources }: { resources: CareResource[] }) {
  const router = useRouter();
  const [data, setData] = useState<SettingsPayload | null>(null);
  const [saved, setSaved] = useState(false);
  const [holdMessage, setHoldMessage] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    void fetch('/api/v1/care/settings')
      .then((r) => r.json())
      .then((d) => setData(d as SettingsPayload))
      .catch(() => undefined);
  }, []);

  async function resume(safe: boolean): Promise<void> {
    const res = await fetch('/api/v1/care/safety/resume', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ safe }),
    });
    const body = (await res.json()) as { status?: string; reason?: string };
    if (body.status === 'ACTIVE') {
      router.push('/care/home');
    } else {
      setHoldMessage(body.reason ?? 'Sessions stay paused for now.');
    }
  }

  async function save(patch: Record<string, unknown>): Promise<void> {
    await fetch('/api/v1/care/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    }).catch(() => undefined);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  async function deleteAccount(): Promise<void> {
    if (
      !window.confirm(
        'Delete your account? Your sessions, reports and plan are erased. This cannot be undone.',
      )
    ) {
      return;
    }
    await fetch('/api/v1/care/settings', { method: 'DELETE' });
    router.push('/care');
  }

  // PROD8 — the DPDP access right the onboarding consent promises:
  // one JSON file with everything we hold (profile, plans, sessions +
  // transcripts + reports, check-ins, instruments).
  async function exportData(): Promise<void> {
    if (exporting) return;
    setExporting(true);
    try {
      const res = await fetch('/api/v1/care/export');
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cureocity-care-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      window.alert('Could not prepare your export right now — please try again.');
    } finally {
      setExporting(false);
    }
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-md px-5 py-10 text-sm text-[var(--color-ink-3)] md:max-w-2xl md:px-8">
        Loading…
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md px-5 py-6 pb-28 md:max-w-2xl md:px-8 md:py-10">
      {data.status === 'SAFETY_HOLD' ? (
        <Card className="mb-4 border-[var(--color-warn)]/30 p-4">
          <h1 className="font-serif text-xl font-semibold">
            That felt heavy. Are you okay to pick back up?
          </h1>
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={() => void resume(true)}>
              I&apos;m safe
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void resume(false)}>
              Struggling — show me help
            </Button>
          </div>
          {holdMessage ? (
            <p className="mt-3 text-sm text-[var(--color-warn)]">{holdMessage}</p>
          ) : null}
          <div className="mt-3 space-y-1.5 text-sm">
            {resources.map((r) => (
              <a
                key={r.number}
                href={`tel:${r.number}`}
                className="block underline underline-offset-2"
              >
                {r.name} · {r.number} ({r.hours})
              </a>
            ))}
          </div>
        </Card>
      ) : null}

      <h1 className="font-serif text-2xl font-semibold">Settings</h1>

      <Card className="mt-4 p-4">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
          Give me time to think
        </span>
        <p className="mt-1 text-xs text-[var(--color-ink-3)]">
          How long a silence before your therapist responds. Longer = more room to think.
        </p>
        <input
          type="range"
          min={400}
          max={1200}
          step={100}
          defaultValue={data.vadSilenceMs}
          className="mt-2 w-full accent-[var(--color-accent)]"
          onMouseUp={(e) =>
            void save({ vadSilenceMs: Number((e.target as HTMLInputElement).value) })
          }
          onTouchEnd={(e) =>
            void save({ vadSilenceMs: Number((e.target as HTMLInputElement).value) })
          }
        />
        <div className="flex justify-between text-[10px] text-[var(--color-ink-3)]">
          <span>quick (400ms)</span>
          <span>unhurried (1200ms)</span>
        </div>
      </Card>

      <Card className="mt-3 p-4">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
          Trusted contact
        </span>
        <div className="mt-2 flex gap-2">
          <input
            defaultValue={data.trustedContactName ?? ''}
            placeholder="Name"
            className="w-1/2 rounded-xl border border-[var(--color-line)] px-3 py-2 text-sm"
            onBlur={(e) => void save({ trustedContactName: e.target.value || null })}
          />
          <input
            defaultValue={data.trustedContactPhone ?? ''}
            placeholder="Phone"
            className="w-1/2 rounded-xl border border-[var(--color-line)] px-3 py-2 text-sm"
            onBlur={(e) => void save({ trustedContactPhone: e.target.value || null })}
          />
        </div>
      </Card>

      <Card className="mt-3 p-4 text-sm">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
          Your therapist
        </span>
        {/* CG2 — the switch Settings always promised. Persona choice is
            clinical alliance: free on every tier, plan + history stay. */}
        <div className="mt-2 grid grid-cols-3 gap-2">
          {CARE_PERSONAS.map((p) => (
            <button
              key={p.name}
              type="button"
              onClick={() => {
                setData({
                  ...data,
                  personaName: p.name,
                  voiceName: p.voiceName,
                  personaStyle: p.style,
                });
                void save({ personaName: p.name, voiceName: p.voiceName, personaStyle: p.style });
              }}
              className={`rounded-2xl border p-2.5 text-center ${
                data.personaName === p.name
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
                  : 'border-[var(--color-line)] bg-[var(--color-surface)]'
              }`}
            >
              <span className="block text-sm font-semibold">{p.name}</span>
              <span className="block text-[11px] text-[var(--color-ink-3)]">{p.blurb}</span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-[var(--color-ink-3)]">
          Changing your therapist keeps your plan and history.
        </p>
      </Card>

      <Card className="mt-3 p-4 text-sm">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
          WhatsApp check-ins
        </span>
        <p className="mt-1 text-xs text-[var(--color-ink-3)]">
          At most two short messages a week, in the evening, never with anything personal in them —
          and stopping is instant, right here. Nothing is sent without this switch.
        </p>
        <div className="mt-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              const next = !data.whatsappOptedIn;
              setData({ ...data, whatsappOptedIn: next });
              void save({ whatsappOptIn: next });
            }}
          >
            {data.whatsappOptedIn ? 'On — turn off' : 'Off — turn on'}
          </Button>
        </div>
      </Card>

      <Card className="mt-3 p-4 text-sm">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
          Your data
        </span>
        <p className="mt-1 text-xs text-[var(--color-ink-3)]">
          Everything here is yours — sessions, reports, plan. Export downloads a copy of all of it;
          delete removes all of it.
        </p>
        <div className="mt-2 flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => void exportData()}>
            {exporting ? 'Preparing…' : 'Download my data'}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void deleteAccount()}>
            Delete my account
          </Button>
        </div>
      </Card>

      {saved ? (
        <p className="mt-3 text-center text-xs text-[var(--color-accent)]">Saved ✓</p>
      ) : null}
    </div>
  );
}
