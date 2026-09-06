import { describe, expect, it, vi } from 'vitest';
import { openCaptureMicrophone } from './microphone-access';
import { runCapturePreflight } from '../capture-preflight';

function setup(state: MediaStreamTrackState = 'live') {
  const track = {
    readyState: state,
    muted: true, // Silence/mute is not evidence that access was denied.
    label: 'Built-in microphone',
    getSettings: vi.fn(() => ({ deviceId: 'built-in' })),
    stop: vi.fn(),
  };
  const stream = {
    getAudioTracks: vi.fn(() => [track]),
    getTracks: vi.fn(() => [track]),
  };
  const getUserMedia = vi.fn(async () => stream as unknown as MediaStream);
  return { track, stream, getUserMedia };
}

describe('microphone access check (no sound test)', () => {
  it('accepts a live microphone in a quiet room and immediately releases it', async () => {
    const { track, getUserMedia } = setup();
    await expect(openCaptureMicrophone(null, { getUserMedia })).resolves.toEqual({
      deviceId: 'built-in',
      label: 'Built-in microphone',
    });
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(track.stop).toHaveBeenCalledTimes(1);
  });

  it('opens exactly the chosen device and preserves the default-device alias', async () => {
    const { getUserMedia } = setup();
    await expect(openCaptureMicrophone('default', { getUserMedia })).resolves.toMatchObject({
      deviceId: 'default',
    });
    expect(getUserMedia).toHaveBeenCalledWith({ audio: { deviceId: { exact: 'default' } } });
  });

  it('propagates permission denial for a specific error message', async () => {
    const error = new DOMException('Synthetic denial', 'NotAllowedError');
    const getUserMedia = vi.fn().mockRejectedValue(error);
    await expect(openCaptureMicrophone(null, { getUserMedia })).rejects.toBe(error);
  });

  it('refuses an ended track and still releases the stream', async () => {
    const { track, getUserMedia } = setup('ended');
    await expect(openCaptureMicrophone(null, { getUserMedia })).rejects.toMatchObject({
      name: 'NotReadableError',
    });
    expect(track.stop).toHaveBeenCalledTimes(1);
  });

  it('refuses a stream without audio and stops every acquired track', async () => {
    const { stream, track, getUserMedia } = setup();
    stream.getAudioTracks.mockReturnValue([]);
    const extra = { ...track, stop: vi.fn() };
    stream.getTracks.mockReturnValue([track, extra]);
    await expect(openCaptureMicrophone(null, { getUserMedia })).rejects.toMatchObject({
      name: 'NotReadableError',
    });
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(extra.stop).toHaveBeenCalledTimes(1);
  });

  it('releases the microphone when device inspection throws', async () => {
    const { track, getUserMedia } = setup();
    track.getSettings.mockImplementation(() => {
      throw new Error('Synthetic inspection failure');
    });
    await expect(openCaptureMicrophone(null, { getUserMedia })).rejects.toThrow(
      'Synthetic inspection failure',
    );
    expect(track.stop).toHaveBeenCalledTimes(1);
  });

  it('does not acquire a microphone for an invalidated check', async () => {
    const { getUserMedia } = setup();
    await expect(openCaptureMicrophone(null, { getUserMedia }, () => false)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('releases a late permission grant after the check is invalidated', async () => {
    const { track, stream, getUserMedia } = setup();
    let active = true;
    let grant!: (stream: MediaStream) => void;
    getUserMedia.mockImplementation(
      () =>
        new Promise((resolve) => {
          grant = resolve;
        }),
    );
    const opening = openCaptureMicrophone(null, { getUserMedia }, () => active);
    const assertion = expect(opening).rejects.toMatchObject({ name: 'AbortError' });
    active = false;
    grant(stream as unknown as MediaStream);
    await assertion;
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(track.getSettings).not.toHaveBeenCalled();
  });

  it('does not open after consent changes while an automatic service check is pending', async () => {
    const { getUserMedia } = setup();
    let active = true;
    let finishService!: (ready: boolean) => void;
    const service = new Promise<boolean>((resolve) => {
      finishService = resolve;
    });
    const checking = runCapturePreflight(
      {},
      {
        isCompatible: () => true,
        permissionState: async () => 'granted',
        listMicrophones: async () => [],
        openMicrophone: (deviceId) =>
          openCaptureMicrophone(deviceId, { getUserMedia }, () => active),
        serviceReady: () => service,
      },
    );
    active = false;
    finishService(true);
    await expect(checking).resolves.toMatchObject({ ready: false });
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});
