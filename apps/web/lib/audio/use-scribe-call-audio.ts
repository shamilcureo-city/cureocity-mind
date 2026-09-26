'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Room } from 'livekit-client';
import { EMPTY_SCRIBE_CALL_AUDIO, ScribeCallAudioMixer } from './scribe-call-audio';

export function useScribeCallAudio(options: { onInterrupted?: (message: string) => void } = {}) {
  const [state, setState] = useState(EMPTY_SCRIBE_CALL_AUDIO);
  const mixerRef = useRef<ScribeCallAudioMixer | null>(null);
  const mountedRef = useRef(true);
  const interruptedRef = useRef(options.onInterrupted);
  interruptedRef.current = options.onInterrupted;

  const getMixer = useCallback(() => {
    if (!mixerRef.current) {
      mixerRef.current = new ScribeCallAudioMixer({
        onState: (next) => {
          if (mountedRef.current) setState(next);
        },
        onInterrupted: (message) => {
          if (mountedRef.current) interruptedRef.current?.(message);
        },
      });
    }
    return mixerRef.current;
  }, []);

  const onRoom = useCallback(
    (room: Room | null) => {
      if (!mountedRef.current) return;
      const mixer = getMixer();
      mixer.setRoom(room);
      if (room)
        void mixer.resume().catch(() => {
          /* State carries the explicit retry message. */
        });
    },
    [getMixer],
  );

  const resume = useCallback(async () => {
    if (!mountedRef.current) throw new Error('Call audio is no longer available.');
    await getMixer().resume();
  }, [getMixer]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      mixerRef.current?.dispose();
      mixerRef.current = null;
    };
  }, []);

  return { ...state, onRoom, resume };
}
