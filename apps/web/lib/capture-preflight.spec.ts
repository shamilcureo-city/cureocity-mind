import { describe, expect, it, vi } from 'vitest';
import { runCapturePreflight } from './capture-preflight';

describe('capture preflight', () => {
  it('checks selected microphone, permission, input level, compatibility and service readiness', async () => {
    const deps = {
      isCompatible: vi.fn().mockReturnValue(true),
      permissionState: vi.fn().mockResolvedValue('granted'),
      listMicrophones: vi.fn().mockResolvedValue([{ deviceId: 'mic-1', label: 'Clinic mic' }]),
      sampleInputLevel: vi.fn().mockResolvedValue(0.22),
      serviceReady: vi.fn().mockResolvedValue(true),
    };

    await expect(runCapturePreflight({ selectedDeviceId: 'mic-1' }, deps)).resolves.toEqual({
      ready: true,
      selectedMicrophone: { deviceId: 'mic-1', label: 'Clinic mic' },
      permission: 'granted',
      inputLevel: 0.22,
      compatibility: true,
      service: true,
      issues: [],
      supportDetails: expect.any(Object),
    });
    expect(deps.sampleInputLevel).toHaveBeenCalledWith('mic-1');
  });

  it('uses therapist language for denial while keeping technical data in support details', async () => {
    const result = await runCapturePreflight(
      { selectedDeviceId: 'missing' },
      {
        isCompatible: () => true,
        permissionState: async () => 'denied',
        listMicrophones: async () => [],
        sampleInputLevel: async () => 0,
        serviceReady: async () => false,
      },
    );

    expect(result.ready).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PERMISSION_DENIED',
          message: 'Allow microphone access in your browser, then try again.',
          action: 'Open browser microphone settings',
        }),
        expect.objectContaining({ code: 'SERVICE_UNAVAILABLE', action: 'Retry service check' }),
      ]),
    );
    expect(JSON.stringify(result.issues)).not.toContain('NotAllowedError');
    expect(result.supportDetails).toMatchObject({
      selectedDeviceId: 'missing',
      permission: 'denied',
    });
  });

  it('does not sample a microphone that is missing', async () => {
    const sample = vi.fn();
    const result = await runCapturePreflight(
      { selectedDeviceId: 'mic-gone' },
      {
        isCompatible: () => true,
        permissionState: async () => 'granted',
        listMicrophones: async () => [{ deviceId: 'other', label: 'Other' }],
        sampleInputLevel: sample,
        serviceReady: async () => true,
      },
    );
    expect(result.ready).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'MICROPHONE_MISSING' }));
    expect(sample).not.toHaveBeenCalled();
  });
});
