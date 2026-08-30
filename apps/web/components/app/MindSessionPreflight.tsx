'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  runCapturePreflight,
  type CaptureMicrophone,
  type CapturePreflightIssue,
} from '@/lib/capture-preflight';
import { Button } from '../ui/Button';

interface Props {
  enabled: boolean;
  liveServiceRequired?: boolean;
  onReadyChange: (ready: boolean) => void;
  onSelectedDeviceIdChange: (deviceId: string | null) => void;
}

/** Therapist-only device/service check shown before any session can start. */
export function MindSessionPreflight({
  enabled,
  liveServiceRequired = true,
  onReadyChange,
  onSelectedDeviceIdChange,
}: Props) {
  const [microphones, setMicrophones] = useState<CaptureMicrophone[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [issues, setIssues] = useState<CapturePreflightIssue[]>([]);
  const [level, setLevel] = useState(0);
  const [checking, setChecking] = useState(false);
  const [details, setDetails] = useState<Record<string, unknown> | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  const check = useCallback(async () => {
    if (!enabled) {
      onReadyChange(true);
      return;
    }
    setChecking(true);
    onReadyChange(false);
    const result = await runCapturePreflight(
      { selectedDeviceId: selectedDeviceId || null },
      {
        isCompatible: () =>
          typeof window !== 'undefined' &&
          !!navigator.mediaDevices?.getUserMedia &&
          typeof AudioContext !== 'undefined',
        permissionState: async () => {
          if (!navigator.permissions?.query) return 'unsupported';
          try {
            return (await navigator.permissions.query({ name: 'microphone' as PermissionName }))
              .state;
          } catch {
            return 'unsupported';
          }
        },
        listMicrophones: async () => {
          const devices = await navigator.mediaDevices.enumerateDevices();
          return devices
            .filter((device) => device.kind === 'audioinput')
            .map((device, index) => ({
              deviceId: device.deviceId,
              label: device.label || `Microphone ${index + 1}`,
            }));
        },
        sampleInputLevel: async (deviceId) => {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: deviceId ? { deviceId: { exact: deviceId } } : true,
          });
          const context = new AudioContext();
          const analyser = context.createAnalyser();
          context.createMediaStreamSource(stream).connect(analyser);
          const samples = new Uint8Array(analyser.fftSize);
          await new Promise((resolve) => setTimeout(resolve, 180));
          analyser.getByteTimeDomainData(samples);
          stream.getTracks().forEach((track) => track.stop());
          await context.close();
          return Math.max(...samples.map((sample) => Math.abs(sample - 128))) / 128;
        },
        serviceReady: async () => {
          if (!liveServiceRequired) return true;
          return fetch('/api/v1/live/health', { cache: 'no-store' })
            .then(async (response) => {
              if (!response.ok) return false;
              const body = (await response.json().catch(() => ({}))) as {
                ok?: boolean;
                atCapacity?: boolean;
              };
              return body.ok === true && body.atCapacity !== true;
            })
            .catch(() => false);
        },
      },
    );
    setMicrophones(
      result.supportDetails['availableDeviceIds'] instanceof Array
        ? result.supportDetails['availableDeviceIds'].map((deviceId, index) => ({
            deviceId: String(deviceId),
            label:
              result.selectedMicrophone?.deviceId === deviceId
                ? (result.selectedMicrophone?.label ?? `Microphone ${index + 1}`)
                : `Microphone ${index + 1}`,
          }))
        : [],
    );
    if (!selectedDeviceId && result.selectedMicrophone) {
      setSelectedDeviceId(result.selectedMicrophone.deviceId);
      onSelectedDeviceIdChange(result.selectedMicrophone.deviceId);
    }
    setIssues(result.issues);
    setLevel(result.inputLevel);
    setDetails(result.supportDetails);
    onReadyChange(result.ready);
    setChecking(false);
  }, [enabled, liveServiceRequired, onReadyChange, onSelectedDeviceIdChange, selectedDeviceId]);

  useEffect(() => {
    void check();
  }, [check]);

  if (!enabled) return null;
  return (
    <section className="mt-5 rounded-xl border border-[var(--color-line-soft)] p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Microphone &amp; live service</p>
          <p className="text-xs text-[var(--color-ink-3)]">Checked before recording begins.</p>
        </div>
        <Button variant="secondary" onClick={() => void check()} disabled={checking}>
          {checking ? 'Checking…' : 'Check again'}
        </Button>
      </div>
      {microphones.length > 0 && (
        <label className="mt-3 block text-xs text-[var(--color-ink-2)]">
          Microphone
          <select
            value={selectedDeviceId}
            onChange={(event) => {
              setSelectedDeviceId(event.target.value);
              onSelectedDeviceIdChange(event.target.value || null);
            }}
            className="mt-1 block w-full rounded-lg border border-[var(--color-line)] bg-white px-3 py-2 text-sm"
          >
            {microphones.map((microphone) => (
              <option key={microphone.deviceId} value={microphone.deviceId}>
                {microphone.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <div
        className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--color-line-soft)]"
        aria-label="Microphone input level"
      >
        <div
          className="h-full bg-[var(--color-accent)]"
          style={{ width: `${Math.min(100, level * 100)}%` }}
        />
      </div>
      {issues.map((issue) => (
        <div
          key={issue.code}
          className="mt-2 rounded-lg bg-[var(--color-warn-soft)] px-3 py-2 text-xs text-[var(--color-warn)]"
        >
          <strong>{issue.message}</strong> {issue.action}.
        </div>
      ))}
      {details && (
        <button
          type="button"
          onClick={() => setShowDetails((value) => !value)}
          className="mt-2 text-xs text-[var(--color-ink-3)] underline"
        >
          {showDetails ? 'Hide support details' : 'Support details'}
        </button>
      )}
      {showDetails && details && (
        <pre className="mt-2 overflow-auto rounded-lg bg-slate-950 p-3 text-[10px] text-white">
          {JSON.stringify(details, null, 2)}
        </pre>
      )}
    </section>
  );
}
