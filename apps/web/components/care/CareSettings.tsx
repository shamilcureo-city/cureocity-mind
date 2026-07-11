'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
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

  if (!data) {
    return (
      <div className="mx-auto max-w-md px-5 py-10 text-sm text-[var(--color-ink-3)]">Loading…</div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-5 py-6 pb-24">
      {data.status === 'SAFETY_HOLD' ? (
        <Card className="mb-4 border-[var(--color-warn)]/30 p-4">
          <h1 className="font-serif text-xl font-semibold">
            Yesterday was heavy. How are you today?
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
        <p className="mt-1">
          {data.personaName} · voice {data.voiceName} · {data.personaStyle}
        </p>
        <p className="mt-1 text-xs text-[var(--color-ink-3)]">
          Changing your therapist keeps your plan and history.
        </p>
      </Card>

      <Card className="mt-3 p-4 text-sm">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
          Your data
        </span>
        <p className="mt-1 text-xs text-[var(--color-ink-3)]">
          Everything here is yours — sessions, reports, plan. Delete removes all of it.
        </p>
        <Button variant="secondary" size="sm" className="mt-2" onClick={() => void deleteAccount()}>
          Delete my account
        </Button>
      </Card>

      {saved ? (
        <p className="mt-3 text-center text-xs text-[var(--color-accent)]">Saved ✓</p>
      ) : null}
    </div>
  );
}
