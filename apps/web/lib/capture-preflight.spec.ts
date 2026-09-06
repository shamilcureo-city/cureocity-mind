import { describe, expect, it, vi } from 'vitest';
import {
  runCapturePreflight,
  type CapturePreflightDependencies,
  type MicrophonePermission,
} from './capture-preflight';

const microphone = { deviceId: 'mic-1', label: 'Clinic microphone' };
function dependencies(permission: MicrophonePermission = 'granted') {
  return {
    isCompatible: vi.fn().mockReturnValue(true),
    permissionState: vi.fn().mockResolvedValue(permission),
    listMicrophones: vi.fn().mockResolvedValue([microphone]),
    openMicrophone: vi.fn().mockResolvedValue(microphone),
    serviceReady: vi.fn().mockResolvedValue(true),
  } satisfies CapturePreflightDependencies;
}
function microphoneError(name: string) {
  return Object.assign(new Error('Sensitive device information must not be displayed'), { name });
}

describe('capture preflight uses browser access, never sound level', () => {
  it('accepts an opened silent microphone without a sampler', async () => {
    const deps = dependencies();
    const result = await runCapturePreflight({ selectedDeviceId: 'mic-1' }, deps);
    expect(result).toMatchObject({
      ready: true,
      microphones: [microphone],
      selectedMicrophone: microphone,
      permission: 'granted',
      compatibility: true,
      service: true,
      issues: [],
    });
    expect(deps.openMicrophone).toHaveBeenCalledWith('mic-1');
    expect(result).not.toHaveProperty('inputLevel');
    expect(result.supportDetails).not.toHaveProperty('inputLevel');
  });

  it.each(['prompt', 'unsupported', 'denied'] as const)(
    'uses actual opening as source of truth over stale %s permission',
    async (permission) => {
      const deps = dependencies(permission);
      const result = await runCapturePreflight({ requestPermission: true }, deps);
      expect(result.ready).toBe(true);
      expect(result.permission).toBe('granted');
      expect(result.issues).toEqual([]);
      expect(deps.openMicrophone).toHaveBeenCalledWith(null);
    },
  );

  it.each(['prompt', 'unsupported', 'denied'] as const)(
    'does not automatically open or prompt when permission is %s',
    async (permission) => {
      const deps = dependencies(permission);
      const result = await runCapturePreflight({}, deps);
      expect(result.ready).toBe(false);
      expect(deps.openMicrophone).not.toHaveBeenCalled();
      expect(result.issues.map((issue) => issue.code)).toEqual([
        permission === 'denied' ? 'PERMISSION_DENIED' : 'PERMISSION_PROMPT',
      ]);
    },
  );

  it('opens synchronously in the explicit gesture, before permission/service queries', async () => {
    const calls: string[] = [];
    const deps = dependencies('prompt');
    deps.openMicrophone.mockImplementation(async () => {
      calls.push('open');
      return microphone;
    });
    deps.permissionState.mockImplementation(async () => {
      calls.push('permission');
      return 'prompt';
    });
    deps.serviceReady.mockImplementation(async () => {
      calls.push('service');
      return true;
    });
    deps.listMicrophones.mockImplementation(async () => {
      calls.push('enumerate');
      return [microphone];
    });
    const check = runCapturePreflight({ requestPermission: true }, deps);
    expect(calls[0]).toBe('open');
    expect(calls).not.toContain('enumerate');
    await expect(check).resolves.toMatchObject({ ready: true });
    expect(calls).toEqual(['open', 'permission', 'service', 'enumerate']);
  });

  it('tries the default before enumeration can hide ungranted microphones', async () => {
    const deps = dependencies('prompt');
    let opened = false;
    deps.listMicrophones.mockImplementation(async () => (opened ? [microphone] : []));
    deps.openMicrophone.mockImplementation(async () => {
      opened = true;
      return microphone;
    });
    const result = await runCapturePreflight({ requestPermission: true }, deps);
    expect(result.ready).toBe(true);
    expect(deps.openMicrophone).toHaveBeenCalledWith(null);
    expect(result.microphones).toEqual([microphone]);
  });

  it.each(['NotAllowedError', 'SecurityError'])(
    'blocks denied opening (%s), even without the Permissions API',
    async (name) => {
      const deps = dependencies('unsupported');
      deps.openMicrophone.mockRejectedValue(microphoneError(name));
      const result = await runCapturePreflight({ requestPermission: true }, deps);
      expect(result.ready).toBe(false);
      expect(result.permission).toBe('denied');
      expect(result.issues[0]?.code).toBe('PERMISSION_DENIED');
      expect(result.supportDetails.microphoneErrorName).toBe(name);
      expect(JSON.stringify(result)).not.toContain('Sensitive device information');
    },
  );

  it.each(['NotFoundError', 'OverconstrainedError'])(
    'distinguishes unavailable selected microphones (%s)',
    async (name) => {
      const deps = dependencies();
      deps.openMicrophone.mockRejectedValue(microphoneError(name));
      const result = await runCapturePreflight({ selectedDeviceId: 'missing' }, deps);
      expect(result.ready).toBe(false);
      expect(result.issues[0]?.code).toBe('MICROPHONE_MISSING');
      expect(deps.openMicrophone).toHaveBeenCalledWith('missing');
    },
  );

  it.each(['NotReadableError', 'AbortError', 'Error', 'private-device-name'])(
    'never treats opening failure (%s) as silence or successful permission',
    async (name) => {
      const deps = dependencies('unsupported');
      deps.openMicrophone.mockRejectedValue(microphoneError(name));
      const result = await runCapturePreflight({ requestPermission: true }, deps);
      expect(result.ready).toBe(false);
      expect(result.issues[0]?.code).toBe('MIC_UNAVAILABLE');
      expect(result.supportDetails.microphoneOpened).toBe(false);
      expect(JSON.stringify(result)).not.toContain('Sensitive device information');
      expect(JSON.stringify(result)).not.toContain('private-device-name');
    },
  );

  it('retains an opened device when enumeration fails', async () => {
    const deps = dependencies();
    deps.listMicrophones.mockRejectedValue(microphoneError('NotReadableError'));
    const result = await runCapturePreflight({}, deps);
    expect(result).toMatchObject({
      ready: true,
      selectedMicrophone: microphone,
      microphones: [microphone],
      supportDetails: { enumerationErrorName: 'NotReadableError' },
    });
  });

  it('retains an opened device when enumeration returns no devices', async () => {
    const deps = dependencies();
    deps.listMicrophones.mockResolvedValue([]);
    const result = await runCapturePreflight({}, deps);
    expect(result.ready).toBe(true);
    expect(result.microphones).toEqual([microphone]);
    expect(result.selectedMicrophone).toEqual(microphone);
  });

  it('query failures remain unverified automatically but cannot override explicit opening', async () => {
    const deps = dependencies();
    deps.permissionState.mockRejectedValue(microphoneError('TypeError'));
    const automatic = await runCapturePreflight({}, deps);
    expect(automatic.ready).toBe(false);
    expect(deps.openMicrophone).not.toHaveBeenCalled();
    const explicit = await runCapturePreflight({ requestPermission: true }, deps);
    expect(explicit.ready).toBe(true);
    expect(explicit.permission).toBe('granted');
    expect(explicit.supportDetails.permissionErrorName).toBe('TypeError');
  });

  it.each([false, 'reject'] as const)('preserves the service gate (%s)', async (state) => {
    const deps = dependencies();
    if (state === 'reject') deps.serviceReady.mockRejectedValue(microphoneError('TypeError'));
    else deps.serviceReady.mockResolvedValue(false);
    const result = await runCapturePreflight({}, deps);
    expect(result.ready).toBe(false);
    expect(result.permission).toBe('granted');
    expect(result.issues.map((issue) => issue.code)).toEqual(['SERVICE_UNAVAILABLE']);
  });

  it('skips permission/device APIs on an incompatible browser', async () => {
    const deps = dependencies();
    deps.isCompatible.mockReturnValue(false);
    const result = await runCapturePreflight({ requestPermission: true }, deps);
    expect(result.ready).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(['CAPTURE_UNSUPPORTED']);
    expect(deps.openMicrophone).not.toHaveBeenCalled();
    expect(deps.permissionState).not.toHaveBeenCalled();
    expect(deps.listMicrophones).not.toHaveBeenCalled();
  });

  it('keeps support details free of raw device identifiers, labels and errors', async () => {
    const result = await runCapturePreflight({}, dependencies());
    const details = JSON.stringify(result.supportDetails);
    expect(details).not.toContain(microphone.deviceId);
    expect(details).not.toContain(microphone.label);
    expect(result.supportDetails).toMatchObject({ microphoneOpened: true, permission: 'granted' });
  });
});
