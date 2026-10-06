'use client';

import { useMemo, useState } from 'react';
import {
  ScribeMicrophoneDialog,
  type ScribeMicrophoneEnvironment,
} from '@/components/app/ScribeMicrophoneDialog';
import { MicrophoneCheckError } from '@/lib/audio/microphone-check';
import { Button } from '@/components/ui/Button';
import { ScribeLogo } from '@/components/ui/ScribeLogo';

type Scenario = 'prompt' | 'granted' | 'denied' | 'ended' | 'silent';

/** No real media APIs, session endpoints, or sockets exist in this fixture. */
function fixture(scenario: Scenario): ScribeMicrophoneEnvironment {
  const device = { deviceId: 'simulated-built-in', label: 'Built-in microphone (simulated)' };
  return {
    permission: async () =>
      Object.assign(new EventTarget(), {
        state: scenario === 'prompt' ? 'prompt' : scenario === 'denied' ? 'denied' : 'granted',
        onchange: null,
      }) as PermissionStatus,
    devices: async () => [device],
    subscribeDevices: () => () => {},
    check: ({ signal, onProgress }) =>
      new Promise((resolve, reject) => {
        const cancel = () => {
          clearTimeout(timer);
          reject(new MicrophoneCheckError('cancelled', 'Simulated cancellation'));
        };
        const timer = setTimeout(() => {
          signal.removeEventListener('abort', cancel);
          if (scenario === 'denied')
            reject(new MicrophoneCheckError('permission-denied', 'Simulated denial'));
          else if (scenario === 'ended')
            reject(new MicrophoneCheckError('ended', 'Simulated device interruption'));
          else resolve({ ...device, heardSound: scenario !== 'silent' });
        }, 1_200);
        signal.addEventListener('abort', cancel, { once: true });
        if (signal.aborted) cancel();
        else
          onProgress({
            stage: 'checking',
            level: scenario === 'silent' ? 0 : 0.04,
            frames: 4800,
            device,
          });
      }),
  };
}

export function ScribeMicrophonePreview() {
  const [scenario, setScenario] = useState<Scenario>('prompt');
  const [open, setOpen] = useState(false);
  const [realDevice, setRealDevice] = useState(false);
  const [completed, setCompleted] = useState(false);
  const environment = useMemo(() => fixture(scenario), [scenario]);
  return (
    <main className="app-wash min-h-screen px-6 py-12 text-[var(--color-ink)]">
      <div className="mx-auto max-w-4xl">
        <ScribeLogo />
        <p className="mt-6 text-sm text-[var(--color-ink-2)]">
          Development-only diagnostics · no patient data, consultation requests, or audio uploads
        </p>
        <section className="mt-12 rounded-3xl border border-[var(--color-line)] bg-white p-8 shadow-[var(--sh-glass)]">
          <h1 className="font-serif text-3xl">Microphone readiness</h1>
          <p className="mt-3 max-w-xl text-[var(--color-ink-2)]">
            Preview the dialog with simulated inputs, or explicitly test this computer’s microphone.
            Opening a dialog does not turn on the microphone.
          </p>
          <label className="mt-8 block text-sm font-medium" htmlFor="preview-scenario">
            Preview state
          </label>
          <select
            id="preview-scenario"
            className="mt-2 block min-h-11 w-full max-w-sm rounded-xl border border-[var(--color-line)] bg-white px-3"
            value={scenario}
            onChange={(event) => setScenario(event.target.value as Scenario)}
          >
            <option value="prompt">Permission needed</option>
            <option value="granted">Access already allowed</option>
            <option value="denied">Microphone blocked</option>
            <option value="ended">Microphone stops during test</option>
            <option value="silent">Working microphone, silent room</option>
          </select>
          <div className="mt-6">
            <Button
              onClick={() => {
                setCompleted(false);
                setRealDevice(false);
                setOpen(true);
              }}
            >
              Start live consult
            </Button>
          </div>
          <div className="mt-8 border-t border-[var(--color-line)] pt-6">
            <p className="mb-4 max-w-xl text-sm text-[var(--color-ink-2)]">
              Real-device check: the input meter runs locally for a few seconds and then stops. No
              speech or audio is saved or sent to a server. No credits are used.
            </p>
            <Button
              variant="secondary"
              onClick={() => {
                setCompleted(false);
                setRealDevice(true);
                setOpen(true);
              }}
            >
              Check this computer’s microphone
            </Button>
          </div>
          {completed && (
            <p role="status" className="mt-6 text-sm">
              {realDevice
                ? 'Local device check complete. The microphone is off; no consultation was started.'
                : 'Readiness confirmed in simulation. A real consultation was not started.'}
            </p>
          )}
        </section>
      </div>
      {open && (
        <ScribeMicrophoneDialog
          environment={realDevice ? undefined : environment}
          onCancel={() => setOpen(false)}
          onContinue={() => {
            setOpen(false);
            setCompleted(true);
          }}
        />
      )}
    </main>
  );
}
