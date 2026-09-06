'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  runCapturePreflight,
  type CaptureMicrophone,
  type CapturePreflightResult,
} from '@/lib/capture-preflight';
import { openCaptureMicrophone } from '@/lib/audio/microphone-access';
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
  const [result, setResult] = useState<CapturePreflightResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const selectedDeviceRef = useRef('');
  const checkVersionRef = useRef(0);

  const check = useCallback(
    async (requestPermission = false) => {
      const version = ++checkVersionRef.current;
      onReadyChange(false);
      setResult(null);
      setCheckError(null);
      if (!enabled) {
        setChecking(false);
        return;
      }
      setChecking(true);
      try {
        const next = await runCapturePreflight(
          { selectedDeviceId: selectedDeviceRef.current || null, requestPermission },
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
            openMicrophone: (deviceId) =>
              openCaptureMicrophone(
                deviceId,
                navigator.mediaDevices,
                () => version === checkVersionRef.current,
              ),
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
        // A device switch, consent change or unmount invalidates old results.
        // The access helper releases its temporary stream even when discarded.
        if (version !== checkVersionRef.current) return;
        setMicrophones(next.microphones);
        if (!selectedDeviceRef.current && next.selectedMicrophone) {
          selectedDeviceRef.current = next.selectedMicrophone.deviceId;
          setSelectedDeviceId(next.selectedMicrophone.deviceId);
          onSelectedDeviceIdChange(next.selectedMicrophone.deviceId || null);
        }
        setResult(next);
        onReadyChange(next.ready);
      } catch {
        if (version === checkVersionRef.current) {
          setCheckError('The microphone check could not finish. Select Check again to retry.');
        }
      } finally {
        if (version === checkVersionRef.current) setChecking(false);
      }
    },
    [enabled, liveServiceRequired, onReadyChange, onSelectedDeviceIdChange],
  );

  useEffect(() => {
    void check();
    return () => {
      ++checkVersionRef.current;
    };
  }, [check]);

  const needsPermission = result?.issues.some((issue) => issue.code === 'PERMISSION_PROMPT');

  if (!enabled) return null;
  return (
    <section
      className="mt-5 rounded-xl border border-[var(--color-line-soft)] p-4"
      aria-busy={checking}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">
            {liveServiceRequired ? 'Microphone & live service' : 'Microphone access'}
          </p>
          <p className="text-xs text-[var(--color-ink-3)]">
            Allow microphone access. No need to speak to pass this check.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={() => void check(true)}
          disabled={checking}
        >
          {checking ? 'Checking…' : needsPermission ? 'Allow microphone' : 'Check again'}
        </Button>
      </div>
      {microphones.length > 0 && (
        <label className="mt-3 block text-xs text-[var(--color-ink-2)]">
          Microphone
          <select
            value={selectedDeviceId}
            onChange={(event) => {
              ++checkVersionRef.current;
              onReadyChange(false);
              selectedDeviceRef.current = event.target.value;
              setSelectedDeviceId(event.target.value);
              onSelectedDeviceIdChange(event.target.value || null);
              void check(true);
            }}
            className="mt-1 block w-full rounded-lg border border-[var(--color-line)] bg-white px-3 py-2 text-sm"
          >
            {!selectedDeviceId && <option value="">System default</option>}
            {selectedDeviceId && !microphones.some((mic) => mic.deviceId === selectedDeviceId) && (
              <option value={selectedDeviceId}>Selected microphone (unavailable)</option>
            )}
            {microphones.map((microphone) => (
              <option key={microphone.deviceId} value={microphone.deviceId}>
                {microphone.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <div role="status" aria-live="polite" className="mt-3 text-xs text-[var(--color-ink-2)]">
        {checking
          ? 'Checking access. If your browser asks, choose Allow.'
          : result?.ready
            ? 'Microphone access is ready. You can start without speaking first.'
            : null}
      </div>
      {checkError && (
        <p role="alert" className="mt-2 text-xs text-[var(--color-warn)]">
          {checkError}
        </p>
      )}
      {result?.issues.map((issue) => (
        <div
          key={issue.code}
          className="mt-2 rounded-lg bg-[var(--color-warn-soft)] px-3 py-2 text-xs text-[var(--color-warn)]"
        >
          <strong>{issue.message}</strong> {issue.action}.
        </div>
      ))}
      {result && (
        <button
          type="button"
          onClick={() => setShowDetails((value) => !value)}
          className="mt-2 text-xs text-[var(--color-ink-3)] underline"
        >
          {showDetails ? 'Hide support details' : 'Support details'}
        </button>
      )}
      {showDetails && result && (
        <pre className="mt-2 overflow-auto rounded-lg bg-slate-950 p-3 text-[10px] text-white">
          {JSON.stringify(result.supportDetails, null, 2)}
        </pre>
      )}
    </section>
  );
}
