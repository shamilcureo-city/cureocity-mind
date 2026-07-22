'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CareTurn, RedeemLiveTokenResponse } from '@cureocity/contracts';
import { useLiveStream } from '@/lib/audio/use-live-stream';
import { LivePlayback } from '@/lib/audio/live-playback';
import {
  CARE_OPENING_CUE,
  CARE_END_SESSION_MIN_REMAINING_SEC,
  careCueFrame,
  dueCareTimeCues,
} from '@/lib/care-live-cues';
import { CrisisTakeover } from './CrisisTakeover';
import type { CareResource } from './SafetyStrip';

type Phase =
  | 'connecting'
  | 'ready'
  | 'live'
  | 'reconnecting'
  | 'ending'
  | 'ended'
  | 'crisis'
  | 'error';

// CP1 reconnect — behind NEXT_PUBLIC_CARE_LIVE_ENGINE_V2 so flag-off is a
// byte-identical rollback (a WS drop ends the session exactly as before).
const CARE_ENGINE_V2 = process.env['NEXT_PUBLIC_CARE_LIVE_ENGINE_V2'] === 'true';
const RECONNECT_MAX_ATTEMPTS = 3; // per drop
const RECONNECT_MAX_TOTAL = 8; // per session — guards a pathological loop
const RECONNECT_BACKOFF_MS = [1000, 2000, 4000];
const RECONNECT_FLOOR_SEC = 120; // below this remaining, finalize instead of resuming
const OPEN_TIMEOUT_MS = 12000; // give up on a socket that never reaches setupComplete

interface Props {
  sessionId: string;
  kind: 'INTAKE' | 'TREATMENT' | 'REVIEW';
  capMin: number;
  personaName: string;
  resources: CareResource[];
  trustedContact: { name: string; phone: string | null } | null;
}

/**
 * The live voice session (AC3, S5) — the heart of the product.
 *
 * Flow (docs/AI_COUNSELING.md §4): redeem the single-use start token →
 * open the WSS → send the setup (url/mock modes; ephemeral carries it
 * until the locked-constraints flow is probe-verified) → WAIT for
 * setupComplete → cue the therapist to open FIRST → stream 16 kHz PCM
 * mic frames up, play 24 kHz PCM
 * down → stitch both transcription streams into turns → mirror every
 * finished turn to the server → end_session tool call → done screen.
 */
export function CareLiveSession({
  sessionId,
  kind,
  capMin,
  personaName,
  resources,
  trustedContact,
}: Props) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [caption, setCaption] = useState<string>('');
  const [captionsOn, setCaptionsOn] = useState(true);
  const [muted, setMuted] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [remainingSec, setRemainingSec] = useState(capMin * 60);

  const wsRef = useRef<WebSocket | null>(null);
  const playbackRef = useRef<LivePlayback | null>(null);
  const seqRef = useRef(0);
  const startedAtRef = useRef<number>(Date.now());
  const pendingTurnsRef = useRef<CareTurn[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mutedRef = useRef(false);
  const phaseRef = useRef<Phase>('connecting');
  const usageRef = useRef({ tokensIn: 0, tokensOut: 0 });
  // CP1 — the browser is the clock. remainingSecRef is the source of truth
  // read by the tool-call handler + countdown; pendingCuesRef holds time cues
  // crossed while the model was mid-utterance, flushed once it pauses.
  const remainingSecRef = useRef(capMin * 60);
  const speakingRef = useRef(false);
  const pendingCuesRef = useRef<string[]>([]);
  // CP1 reconnect state
  const resumeHandleRef = useRef<string | null>(null); // latest Gemini session-resumption handle
  const reconnectingRef = useRef(false); // single-flight guard for the reconnect loop
  const reconnectTotalRef = useRef(0); // per-session reconnect count (bounded)
  const openResolveRef = useRef<((ok: boolean) => void) | null>(null); // resolves on setupComplete
  const reconnectRef = useRef<() => void>(() => {});
  const openLiveSocketRef = useRef<
    (credential: RedeemLiveTokenResponse, resumeHandle: string | null) => Promise<boolean>
  >(() => Promise.resolve(false));
  const cancelledRef = useRef(false);
  phaseRef.current = phase;
  mutedRef.current = muted;
  remainingSecRef.current = remainingSec;
  speakingRef.current = speaking;

  const mic = useLiveStream({
    onFrame: (pcm) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN || mutedRef.current) return;
      // Base64 realtime frames, ~128 ms each from the worklet cadence.
      // NOTE for the ai-studio backend: the AC0 probe pins the exact
      // envelope key (media_chunks vs media) against the live API; the
      // mock accepts any realtime_input shape.
      let binary = '';
      for (let i = 0; i < pcm.length; i++) binary += String.fromCharCode(pcm[i]!);
      ws.send(
        JSON.stringify({
          realtime_input: {
            media_chunks: [{ mime_type: 'audio/pcm;rate=16000', data: btoa(binary) }],
          },
        }),
      );
    },
  });
  const micStartRef = useRef(mic.start);
  const micStopRef = useRef(mic.stop);
  micStartRef.current = mic.start;
  micStopRef.current = mic.stop;

  const pushTurn = useCallback((role: 'user' | 'therapist', text: string) => {
    if (!text.trim()) return;
    pendingTurnsRef.current.push({
      seq: seqRef.current++,
      role,
      text: text.slice(0, 4000),
      atMs: Date.now() - startedAtRef.current,
    });
  }, []);

  const enterCrisis = useCallback(
    async (source: 'model_tool' | 'user_button', reason?: string) => {
      setPhase('crisis');
      playbackRef.current?.flush();
      void micStopRef.current();
      wsRef.current?.close();
      try {
        await fetch(`/api/v1/care/sessions/${sessionId}/crisis`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ source, reason }),
        });
      } catch {
        // The takeover renders regardless — resources came in via props.
      }
    },
    [sessionId],
  );

  const flushTurns = useCallback(async () => {
    const batch = pendingTurnsRef.current.splice(0, 50);
    if (batch.length === 0) return;
    try {
      const res = await fetch(`/api/v1/care/sessions/${sessionId}/turns`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ turns: batch }),
      });
      if (res.ok) {
        const body = (await res.json()) as { action?: string };
        if (body.action === 'crisis_stop' && phaseRef.current !== 'crisis') {
          setPhase('crisis');
          playbackRef.current?.flush();
          void micStopRef.current();
          wsRef.current?.close();
        }
      }
    } catch {
      pendingTurnsRef.current.unshift(...batch); // retry on the next tick
    }
  }, [sessionId]);

  const endSession = useCallback(async () => {
    if (phaseRef.current === 'ending' || phaseRef.current === 'ended') return;
    setPhase('ending');
    void micStopRef.current();
    await flushTurns();
    wsRef.current?.close();
    await playbackRef.current?.close();
    try {
      const usage = usageRef.current;
      await fetch(`/api/v1/care/sessions/${sessionId}/end`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          usage.tokensIn > 0 || usage.tokensOut > 0 ? { usage: { ...usage } } : {},
        ),
      });
    } catch {
      /* the sweeper finalizes if this failed */
    }
    setPhase('ended');
    router.push(`/care/session/${sessionId}/report`);
  }, [flushTurns, router, sessionId]);
  const endSessionRef = useRef(endSession);
  endSessionRef.current = endSession;

  const handleServerMessage = useCallback(
    (msg: Record<string, unknown>) => {
      if ('setupComplete' in msg) {
        const resuming = reconnectingRef.current;
        setPhase('live');
        const ws = wsRef.current;
        if (!resuming) {
          startedAtRef.current = Date.now();
          // CP1 — the countdown only starts NOW (not at page mount), so connect +
          // setup latency no longer eats therapy time. Reset the clock to full.
          remainingSecRef.current = capMin * 60;
          setRemainingSec(capMin * 60);
          // Meera opens the session — she speaks FIRST. The model stays silent
          // until it receives an input turn, so send a one-time, non-spoken cue
          // telling it to greet now. This text turn is NOT mirrored to the
          // transcript — only audio-transcription events are pushed — so it
          // never appears as if the user said it.
          if (ws && ws.readyState === WebSocket.OPEN) ws.send(careCueFrame(CARE_OPENING_CUE));
        } else if (ws && ws.readyState === WebSocket.OPEN && !resumeHandleRef.current) {
          // Resumed after a drop but with NO handle (dropped before the first
          // resumption update) — the model has no restored context, so at least
          // stop it re-greeting or restarting. The clock keeps running.
          ws.send(
            careCueFrame(
              '[RESUME — do not read aloud] The call dropped for a moment and reconnected. Continue naturally where the conversation was; do NOT greet again or restart.',
            ),
          );
        }
        void micStartRef.current();
        openResolveRef.current?.(true);
        return;
      }
      // CP1 reconnect — capture the resumption handle Gemini offers, and treat
      // goAway (imminent server-side close) as a signal to reconnect early.
      if (CARE_ENGINE_V2) {
        const sru = (msg['sessionResumptionUpdate'] ?? msg['session_resumption_update']) as
          | { newHandle?: string; new_handle?: string; resumable?: boolean }
          | undefined;
        if (sru) {
          const handle = sru.newHandle ?? sru.new_handle;
          if (handle && sru.resumable !== false) resumeHandleRef.current = handle;
          return;
        }
        if ('goAway' in msg || 'go_away' in msg) {
          reconnectRef.current();
          return;
        }
      }
      // CG1 COGS metering — usageMetadata frames carry CUMULATIVE counts;
      // track the max seen and relay it at session end (the server never
      // sees usage otherwise: the socket is browser↔Gemini direct).
      const um = (msg['usageMetadata'] ?? msg['usage_metadata']) as
        | Record<string, unknown>
        | undefined;
      if (um) {
        const num = (v: unknown): number => (typeof v === 'number' && v >= 0 ? v : 0);
        const inTok = num(um['promptTokenCount'] ?? um['prompt_token_count']);
        const outTok = num(
          um['candidatesTokenCount'] ?? um['candidates_token_count'] ?? um['responseTokenCount'],
        );
        const u = usageRef.current;
        u.tokensIn = Math.max(u.tokensIn, Math.round(inTok));
        u.tokensOut = Math.max(u.tokensOut, Math.round(outTok));
      }
      const sc = msg['serverContent'] as Record<string, unknown> | undefined;
      if (sc) {
        // Both snake_case (the recipe / mock) and camelCase (SDK-shaped)
        // keys are handled — defensive against upstream drift.
        const inT = (sc['input_transcription'] ?? sc['inputTranscription']) as
          | { text?: string; finished?: boolean }
          | undefined;
        const outT = (sc['output_transcription'] ?? sc['outputTranscription']) as
          | { text?: string; finished?: boolean }
          | undefined;
        if (inT?.text && inT.finished !== false) pushTurn('user', inT.text);
        if (outT?.text) {
          setCaption(outT.text);
          if (outT.finished !== false) pushTurn('therapist', outT.text);
        }
        if (sc['interrupted']) playbackRef.current?.flush();
        const modelTurn = sc['modelTurn'] as
          | { parts?: Array<{ inlineData?: { data?: string } }> }
          | undefined;
        for (const part of modelTurn?.parts ?? []) {
          if (part.inlineData?.data) playbackRef.current?.enqueueBase64(part.inlineData.data);
        }
        return;
      }
      const toolCall = msg['toolCall'] as
        | { functionCalls?: Array<{ id?: string; name?: string; args?: Record<string, unknown> }> }
        | undefined;
      for (const call of toolCall?.functionCalls ?? []) {
        if (call.name === 'end_session') {
          // CP1 — the model has no reliable clock. DECLINE a close it proposes
          // while there is still real time left (the honest close is driven by
          // the wind-down [TIME SIGNAL] near the end); accept once inside the
          // closing window. A user-tapped end never routes through here.
          const ws = wsRef.current;
          if (
            remainingSecRef.current > CARE_END_SESSION_MIN_REMAINING_SEC &&
            ws &&
            ws.readyState === WebSocket.OPEN
          ) {
            ws.send(
              JSON.stringify({
                tool_response: {
                  function_responses: [
                    {
                      id: call.id,
                      name: 'end_session',
                      response: {
                        accepted: false,
                        minutes_remaining: Math.round(remainingSecRef.current / 60),
                        instruction:
                          'Not time to end yet — keep the session going and wait for the closing time signal.',
                      },
                    },
                  ],
                },
              }),
            );
          } else {
            void endSessionRef.current();
          }
        }
      }
    },
    [pushTurn],
  );

  // CP1 — open (or re-open) the live socket, wire the shared handlers, send the
  // setup (injecting a resumption handle on a reconnect), and resolve on
  // setupComplete. onclose decides: a drop mid-session reconnects (engine v2), a
  // pre-setup close is a start error, and a close during a reconnect attempt is
  // left to the reconnect loop.
  const openLiveSocket = useCallback(
    (credential: RedeemLiveTokenResponse, resumeHandle: string | null): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        let settled = false;
        const finish = (ok: boolean): void => {
          if (settled) return;
          settled = true;
          if (openResolveRef.current === finish) openResolveRef.current = null;
          resolve(ok);
        };
        openResolveRef.current = finish;

        const wsHost = (() => {
          try {
            return new URL(credential.wsUrl).host;
          } catch {
            return '?';
          }
        })();

        const ws = new WebSocket(credential.wsUrl);
        wsRef.current = ws;
        ws.onopen = () => {
          const raw = 'setup' in credential ? credential.setup : undefined;
          if (!raw) return;
          let payload: unknown = raw;
          if (resumeHandle) {
            try {
              const cloned = JSON.parse(JSON.stringify(raw)) as { setup?: Record<string, unknown> };
              if (cloned.setup) cloned.setup['session_resumption'] = { handle: resumeHandle };
              payload = cloned;
            } catch {
              payload = raw;
            }
          }
          ws.send(JSON.stringify(payload));
        };
        ws.onmessage = (ev) => {
          void (async () => {
            try {
              const text = typeof ev.data === 'string' ? ev.data : await (ev.data as Blob).text();
              handleServerMessage(JSON.parse(text) as Record<string, unknown>);
            } catch {
              /* non-JSON frame — ignore */
            }
          })();
        };
        ws.onerror = () => {
          /* a close event always follows; the decision is made there */
        };
        ws.onclose = (event) => {
          const detail = `code=${event.code}${event.reason ? ` · ${event.reason}` : ''}`;
          console.error(
            `[care-live] websocket closed — ${credential.mode} · ${wsHost} — ${detail}`,
          );
          finish(false);
          if (
            phaseRef.current === 'ending' ||
            phaseRef.current === 'ended' ||
            phaseRef.current === 'crisis'
          ) {
            return;
          }
          // Inside a reconnect attempt: the loop drives retries; don't recurse.
          if (reconnectingRef.current) return;
          if (phaseRef.current === 'live') {
            if (
              CARE_ENGINE_V2 &&
              remainingSecRef.current > RECONNECT_FLOOR_SEC &&
              reconnectTotalRef.current < RECONNECT_MAX_TOTAL
            ) {
              reconnectRef.current();
            } else {
              void endSessionRef.current();
            }
            return;
          }
          // Closed BEFORE ever going live → a setup/auth/config failure.
          if (phaseRef.current === 'ready' || phaseRef.current === 'connecting') {
            setError(`Couldn't start the session — ${credential.mode} · ${wsHost} — ${detail}.`);
            setPhase('error');
          }
        };
        setTimeout(() => finish(false), OPEN_TIMEOUT_MS);
      }),
    [handleServerMessage],
  );
  openLiveSocketRef.current = openLiveSocket;

  // CP1 — a bounded, single-flight reconnect loop. Pauses the mic, re-mints a
  // credential (the start token is long gone), and re-opens with the resumption
  // handle so Gemini restores the conversation. Exhausting the retries finalizes
  // the session honestly rather than dead-ending.
  const reconnect = useCallback((): void => {
    if (reconnectingRef.current || cancelledRef.current) return;
    if (
      remainingSecRef.current <= RECONNECT_FLOOR_SEC ||
      reconnectTotalRef.current >= RECONNECT_MAX_TOTAL
    ) {
      void endSessionRef.current();
      return;
    }
    reconnectingRef.current = true;
    reconnectTotalRef.current += 1;
    setPhase('reconnecting');
    void micStopRef.current();
    try {
      wsRef.current?.close();
    } catch {
      /* already closing */
    }
    void (async () => {
      for (let attempt = 0; attempt < RECONNECT_MAX_ATTEMPTS; attempt++) {
        if (cancelledRef.current || remainingSecRef.current <= RECONNECT_FLOOR_SEC) break;
        let credential: RedeemLiveTokenResponse | null = null;
        try {
          const res = await fetch(`/api/v1/care/sessions/${sessionId}/reconnect-token`, {
            method: 'POST',
          });
          if (res.ok) credential = (await res.json()) as RedeemLiveTokenResponse;
        } catch {
          /* transient — retry */
        }
        if (credential) {
          const ok = await openLiveSocketRef.current(credential, resumeHandleRef.current);
          if (ok) {
            reconnectingRef.current = false; // setupComplete has put us back to 'live'
            return;
          }
        }
        await new Promise((r) => setTimeout(r, RECONNECT_BACKOFF_MS[attempt] ?? 4000));
      }
      reconnectingRef.current = false;
      if (!cancelledRef.current) void endSessionRef.current();
    })();
  }, [sessionId]);
  reconnectRef.current = reconnect;

  useEffect(() => {
    let cancelled = false;
    playbackRef.current = new LivePlayback((s) => setSpeaking(s));

    async function connect(): Promise<void> {
      // The single-use start token is handed over via sessionStorage by
      // the home screen (never in the URL, never logged).
      const startToken = sessionStorage.getItem(`care-start-${sessionId}`);
      sessionStorage.removeItem(`care-start-${sessionId}`);
      if (!startToken) {
        setError('This session link has expired — start a new session from home.');
        setPhase('error');
        return;
      }
      let credential: RedeemLiveTokenResponse;
      try {
        const res = await fetch(`/api/v1/care/sessions/${sessionId}/token`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ startToken }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `Redeem failed (${res.status})`);
        }
        credential = (await res.json()) as RedeemLiveTokenResponse;
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message);
        setPhase('error');
        return;
      }
      if (cancelled) return;
      // The socket wiring, reconnect decisions, and setup-send all live in the
      // shared openLiveSocket (initial connect passes no resumption handle).
      void openLiveSocketRef.current(credential, null);
      setPhase('ready');
    }

    cancelledRef.current = false;
    void connect();
    flushTimerRef.current = setInterval(() => void flushTurns(), 3000);
    const countdown = setInterval(() => {
      // CP1 — the clock runs while the session is live OR reconnecting (a drop
      // must not stop the clock), but not before it has ever gone live.
      if (phaseRef.current !== 'live' && phaseRef.current !== 'reconnecting') return;
      const prev = remainingSecRef.current;
      const next = prev - 1;
      // Silent time cues — the model's clock. Queue any crossed this tick and
      // flush them only when the model isn't mid-utterance, so a cue never
      // cuts across its speech. dueCareTimeCues ranges over (prev, next], so a
      // multi-second tick still catches every crossing.
      for (const cue of dueCareTimeCues(prev, next)) pendingCuesRef.current.push(cue.text);
      if (pendingCuesRef.current.length > 0 && !speakingRef.current) {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          for (const text of pendingCuesRef.current) ws.send(careCueFrame(text));
          pendingCuesRef.current = [];
        }
      }
      remainingSecRef.current = next <= 0 ? 0 : next;
      if (next <= 0) {
        setRemainingSec(0);
        void endSessionRef.current();
        return;
      }
      setRemainingSec(next);
    }, 1000);

    return () => {
      cancelled = true;
      cancelledRef.current = true;
      if (flushTimerRef.current) clearInterval(flushTimerRef.current);
      clearInterval(countdown);
      wsRef.current?.close();
      void playbackRef.current?.close();
      void micStopRef.current();
    };
  }, [sessionId]);

  if (phase === 'crisis') {
    return <CrisisTakeover resources={resources} trustedContact={trustedContact} />;
  }

  const mm = Math.floor(remainingSec / 60);
  const ss = String(remainingSec % 60).padStart(2, '0');
  const kindLabel =
    kind === 'INTAKE' ? 'First session' : kind === 'REVIEW' ? 'Review session' : 'Session';

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-[#101d1a] text-[#e9efe9]">
      <div className="flex items-center justify-between px-5 pt-5 text-xs tracking-wide text-[#8fb3a4]">
        <span>
          ● {mm}:{ss} remaining · {personaName}
        </span>
        <button
          type="button"
          className="underline-offset-2 hover:underline"
          onClick={() => setCaptionsOn((c) => !c)}
        >
          captions {captionsOn ? 'on' : 'off'}
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
        <div
          aria-hidden
          className={`h-28 w-28 rounded-full shadow-[0_0_0_14px_rgba(95,156,133,0.12),0_0_0_30px_rgba(95,156,133,0.06)] transition-transform duration-700 motion-safe:animate-pulse ${
            phase === 'reconnecting'
              ? 'bg-[radial-gradient(circle_at_34%_30%,#e6c79a,#b98a4e_58%,#6f5027)] opacity-70'
              : 'bg-[radial-gradient(circle_at_34%_30%,#9fd3bd,#3f8a6d_58%,#22503f)]'
          } ${speaking ? 'scale-110' : 'scale-100'}`}
        />
        <div className="min-h-10 max-w-xs text-[15px] text-[#cfe4d8]">
          {phase === 'connecting' || phase === 'ready'
            ? `Connecting your ${kindLabel.toLowerCase()}…`
            : phase === 'reconnecting'
              ? 'Reconnecting — nothing is lost. One moment…'
              : phase === 'ending'
                ? 'Wrapping up…'
                : captionsOn
                  ? caption
                  : ''}
          {phase === 'error' ? <span className="text-[#eec3a8]">{error}</span> : null}
        </div>
        {phase === 'error' ? (
          <button
            type="button"
            onClick={() => router.push(`/care/session/${sessionId}/report`)}
            className="rounded-full border border-[#2c4a41] px-5 py-2 text-sm text-[#cfe4d8]"
          >
            See what was captured →
          </button>
        ) : null}
      </div>

      <div className="flex justify-center gap-3 pb-4">
        <button
          type="button"
          onClick={() => setMuted((m) => !m)}
          className={`rounded-full border px-5 py-2 text-sm ${
            muted ? 'border-[#eec3a8] text-[#eec3a8]' : 'border-[#2c4a41] text-[#cfe4d8]'
          }`}
        >
          {muted ? '🔇 unmute' : '🎙 mute'}
        </button>
        <button
          type="button"
          onClick={() => void endSession()}
          className="rounded-full border border-[#5c3a2c] bg-[#37231d] px-5 py-2 text-sm text-[#eec3a8]"
        >
          ■ end session
        </button>
      </div>

      <button
        type="button"
        onClick={() => void enterCrisis('user_button')}
        className="border-t border-[#3a2d22] bg-[#26201a] px-4 py-3 text-sm text-[#eec3a8]"
      >
        ⚠ <b>Need urgent help?</b> Tap here — a person, right now.
      </button>
    </div>
  );
}
