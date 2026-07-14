'use client';

import { useEffect, useRef, useState } from 'react';
import type { CareResource } from './SafetyStrip';
import { CareLiveSession } from './CareLiveSession';

/**
 * CG2 — the session prelude + live session, composed (docs/CARE_GROWTH_SYSTEM.md §4).
 *
 * The prelude runs BEFORE CareLiveSession mounts, which is load-bearing:
 * CareLiveSession redeems the single-use start token on mount, so a mic-
 * permission failure used to burn the token and strand the session. Here
 * the mic is granted (and heard — the orb blooms with the user's own
 * voice) before "I'm ready" lets the redeem happen. The will/won't/can't
 * cards are role induction; the SOS preview makes the strip read as
 * safety, not alarm.
 */

interface FlowProps {
  sessionId: string;
  kind: 'INTAKE' | 'TREATMENT' | 'REVIEW';
  capMin: number;
  personaName: string;
  resources: CareResource[];
  trustedContact: { name: string; phone: string | null } | null;
}

export function CareSessionFlow(props: FlowProps) {
  const [ready, setReady] = useState(false);
  if (ready) return <CareLiveSession {...props} />;
  return <CareSessionPrelude personaName={props.personaName} onReady={() => setReady(true)} />;
}

type MicState = 'idle' | 'asking' | 'granted' | 'heard' | 'denied';

function CareSessionPrelude({
  personaName,
  onReady,
}: {
  personaName: string;
  onReady: () => void;
}) {
  const [mic, setMic] = useState<MicState>('idle');
  const [level, setLevel] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number>(0);
  const micRef = useRef<MicState>('idle');
  micRef.current = mic;

  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      void ctxRef.current?.close().catch(() => undefined);
    };
  }, []);

  async function askMic(): Promise<void> {
    setMic('asking');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      setMic('granted');
      const ctx = new AudioContext();
      ctxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      const tick = (): void => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i]! - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        setLevel(rms);
        if (rms > 0.06 && micRef.current === 'granted') setMic('heard');
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      setMic('denied');
    }
  }

  function start(): void {
    // Release the preview stream — the live session opens its own capture.
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    void ctxRef.current?.close().catch(() => undefined);
    onReady();
  }

  const orbScale = 1 + Math.min(0.35, level * 2.2);

  return (
    <div className="fixed inset-0 z-30 flex flex-col overflow-y-auto bg-[#101d1a] text-[#e9efe9]">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-6 py-8 md:max-w-lg">
        <h1 className="font-serif text-2xl font-semibold">Before you meet {personaName}</h1>

        <div className="mt-6 flex flex-col items-center gap-3">
          <div
            aria-hidden
            className="h-24 w-24 rounded-full bg-[radial-gradient(circle_at_34%_30%,#9fd3bd,#3f8a6d_58%,#22503f)] shadow-[0_0_0_12px_rgba(95,156,133,0.12),0_0_0_26px_rgba(95,156,133,0.06)] transition-transform duration-150 motion-reduce:transition-none"
            style={{ transform: `scale(${mic === 'granted' || mic === 'heard' ? orbScale : 1})` }}
          />
          {mic === 'idle' || mic === 'asking' ? (
            <>
              <p className="text-center text-sm text-[#cfe4d8]">
                {personaName} needs your mic. It stays on this page — your audio becomes a
                transcript you can read after, never a kept recording.
              </p>
              <button
                type="button"
                disabled={mic === 'asking'}
                onClick={() => void askMic()}
                className="rounded-full bg-[#3f8a6d] px-6 py-2.5 text-sm font-semibold text-white"
              >
                {mic === 'asking' ? 'Asking…' : 'Allow the mic'}
              </button>
            </>
          ) : null}
          {mic === 'granted' ? (
            <p className="text-center text-sm text-[#cfe4d8]">
              Say anything — &ldquo;testing, testing&rdquo; works.
            </p>
          ) : null}
          {mic === 'heard' ? (
            <p className="text-center text-sm font-semibold text-[#9fd3bd]">She can hear you. ✓</p>
          ) : null}
          {mic === 'denied' ? (
            <p className="text-center text-sm text-[#eec3a8]">
              Your browser blocked the mic. Open your browser&apos;s site settings, allow the
              microphone for this page, then reload — nothing starts until you&apos;re ready.
            </p>
          ) : null}
        </div>

        <div className="mt-8 space-y-3 text-sm">
          <div className="rounded-xl border border-[#24413a] bg-[#142420] p-3.5">
            <b className="text-[#9fd3bd]">She will</b> — listen, ask one thing at a time, remember
            what you tell her.
          </div>
          <div className="rounded-xl border border-[#24413a] bg-[#142420] p-3.5">
            <b className="text-[#9fd3bd]">She won&apos;t</b> — judge you, rush you, or pretend to be
            human.
          </div>
          <div className="rounded-xl border border-[#3a2d22] bg-[#26201a] p-3.5">
            <b className="text-[#eec3a8]">She can&apos;t</b> — handle an emergency. The ⚠ button is
            always at the bottom of your session: a person, right now.
          </div>
        </div>

        <p className="mt-5 text-center text-[12px] text-[#8fb3a4]">
          🎧 Headphones make it feel private — and sound better. Take your time: she waits for you
          to finish before speaking.
        </p>

        <div className="mt-6 pb-8">
          <button
            type="button"
            disabled={mic !== 'granted' && mic !== 'heard'}
            onClick={start}
            className="w-full rounded-full bg-[#3f8a6d] px-6 py-3 text-sm font-semibold text-white disabled:opacity-40"
          >
            I&apos;m ready — start my session
          </button>
        </div>
      </div>
    </div>
  );
}
