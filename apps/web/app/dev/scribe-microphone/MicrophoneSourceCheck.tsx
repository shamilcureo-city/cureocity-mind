'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { checkMicrophoneSource, type SourceCheckEvent, type SourceCheckMode } from './source-check';

export function MicrophoneSourceCheck({ disabled }: { disabled: boolean }) {
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const [busy, setBusy] = useState(false);
  const [events, setEvents] = useState<SourceCheckEvent[]>([]);
  const [mode, setMode] = useState<SourceCheckMode>('default');
  const [deviceId, setDeviceId] = useState('');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    mounted.current = true;
    void navigator.mediaDevices
      ?.enumerateDevices()
      .then((list) => {
        if (mounted.current) setDevices(list.filter((device) => device.kind === 'audioinput'));
      })
      .catch(() => {});
    return () => {
      mounted.current = false;
      request.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (disabled) request.current?.abort();
  }, [disabled]);
  function start() {
    if (request.current || disabled) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setEvents([]);
    void checkMicrophoneSource({
      mode,
      deviceId: deviceId || undefined,
      signal: controller.signal,
      onEvent: (event) => {
        if (mounted.current) setEvents((previous) => [...previous.slice(-31), event]);
      },
    }).finally(() => {
      if (request.current === controller) request.current = null;
      if (mounted.current) setBusy(false);
    });
  }
  return (
    <section className="mt-6 rounded-3xl border border-[var(--color-line)] bg-white p-8">
      <h2 className="font-serif text-2xl">Isolate microphone access</h2>
      <p className="my-4 max-w-2xl text-sm text-[var(--color-ink-2)]">
        Compare microphone access alone with empty audio contexts at 48 kHz or the browser’s native
        rate. No audio nodes are added; the microphone is never connected to speakers or a sample
        reader. The observation normally lasts three seconds after the context starts (or the
        microphone opens for source-only modes). Capture stops as soon as the browser can respond; a
        check taking eight seconds after opening the microphone is marked overdue, never passed. No
        audio is saved or uploaded. A completed observation does not prove audio frames or
        transcription work.
      </p>
      <label htmlFor="source-check-device" className="mb-2 block text-sm font-medium">
        Source-check microphone
      </label>
      <select
        id="source-check-device"
        value={deviceId}
        disabled={disabled || busy}
        className="mb-4 block min-h-11 w-full max-w-md rounded-xl border border-[var(--color-line)] bg-white px-3"
        onChange={(event) => {
          setDeviceId(event.target.value);
          setEvents([]);
        }}
      >
        <option value="">System default microphone</option>
        {devices.map((device, index) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.label || `Microphone ${index + 1}`}
          </option>
        ))}
      </select>
      <label htmlFor="source-check-mode" className="mb-2 block text-sm font-medium">
        Check mode
      </label>
      <select
        id="source-check-mode"
        value={mode}
        disabled={disabled || busy}
        className="mb-4 block min-h-11 w-full max-w-md rounded-xl border border-[var(--color-line)] bg-white px-3"
        onChange={(event) => {
          setMode(event.target.value as SourceCheckMode);
          setEvents([]);
        }}
      >
        <option value="default">Browser defaults — no processing preferences</option>
        <option value="scribe">Scribe preferences — 48 kHz, mono, noise and echo processing</option>
        <option value="context">Scribe preferences + empty 48 kHz audio context</option>
        <option value="silent-context">Scribe preferences + silent-output audio context</option>
        <option value="native-context">Scribe preferences + native-rate audio context</option>
      </select>
      {mode === 'silent-context' && (
        <p className="mb-4 max-w-2xl text-sm text-[var(--color-ink-2)]">
          Requires browser support for a silent output sink. If unsupported, this check stops; it
          never falls back to the normal output device.
        </p>
      )}
      <Button
        variant="secondary"
        disabled={disabled}
        onClick={busy ? () => request.current?.abort() : start}
      >
        {busy ? 'Stop local check' : 'Run selected local check'}
      </Button>
      {events.length > 0 && (
        <div className="mt-4" role="status" aria-live="polite">
          <p>
            {busy
              ? 'Local microphone check running.'
              : events.at(-1)?.phase === 'unsupported'
                ? 'This browser cannot run the selected context mode. No fallback was used; any opened microphone was released.'
                : events.at(-1)?.deadlineExceeded
                  ? 'Check exceeded its capture deadline. The browser resumed and the microphone was released; this is not a successful check.'
                  : 'Observation finished. Microphone released; inspect the events below, not a transcription pass.'}
          </p>
          <pre className="mt-3 overflow-auto rounded-xl bg-slate-50 p-4 text-xs">
            {JSON.stringify(events, null, 2)}
          </pre>
        </div>
      )}
    </section>
  );
}
