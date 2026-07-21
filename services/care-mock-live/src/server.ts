import { createServer } from 'node:http';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';

/**
 * Cureocity Care — the scripted local twin of the Gemini Live endpoint
 * (CARE_LIVE_BACKEND=mock; docs/AI_COUNSELING.md §4.10).
 *
 * Speaks the exact wire protocol the browser client implements:
 *   client → setup JSON (first message)          → replies {"setupComplete":{}}
 *   client → {"realtime_input": ...} audio       → advances the script
 *   server → {"serverContent":{"output_transcription"|"input_transcription"}}
 *            (snake_case — the recipe's shape), PCM24 audio via
 *            serverContent.modelTurn.parts[].inlineData, turnComplete,
 *            and {"toolCall":{functionCalls:[...]}} for flag_crisis /
 *            end_session.
 *
 * Scripts are picked from the setup's system_instruction (the prompt is
 * kind-branched, so the mock keys off its phrases) — INTAKE / REVIEW /
 * TREATMENT — or forced via `?fixture=crisis|intake|treatment|review`
 * on the WS URL (CI sets CARE_MOCK_LIVE_URL=ws://localhost:8788/?fixture=…).
 *
 * The crisis fixture emits a user line the deterministic keyword screen
 * MUST catch when the client mirrors it, plus a flag_crisis tool call —
 * both crisis paths get exercised.
 */
const PORT = Number(process.env['CARE_MOCK_LIVE_PORT'] ?? 8788);

type FixtureKind = 'intake' | 'treatment' | 'review' | 'crisis';

interface Exchange {
  userLine: string;
  therapistLine: string;
}

const SCRIPTS: Record<FixtureKind, Exchange[]> = {
  intake: [
    {
      userLine: "[mock] It's mostly work. I can't switch off and I'm not sleeping.",
      therapistLine:
        "[mock] Thank you for saying that so plainly. When you say you can't switch off — what does a bad evening actually look like?",
    },
    {
      userLine: '[mock] I lie awake till 3 replaying meetings. Sundays are the worst.',
      therapistLine:
        '[mock] So the week starts costing you before it begins. Has it always been like this, or did something shift?',
    },
    {
      userLine: '[mock] Since March, after a review meeting that went badly.',
      therapistLine:
        "[mock] That makes sense of a lot. I've got what I need for today — your written assessment and plan will be ready in a minute, and we'll agree the goals together. You did well to come. ",
    },
  ],
  treatment: [
    {
      userLine: '[mock] I did the thought record three times this week.',
      therapistLine:
        "[mock] Three times — that's the practice doing its work. Pick the hottest thought of the three; let's look at the evidence together.",
    },
    {
      userLine: "[mock] Okay… 'I'll mess up the review'. It felt 90% true on Tuesday.",
      therapistLine:
        '[mock] Said out loud, is that a fact or a prediction? What actually happened the last three times?',
    },
    {
      userLine: '[mock] …it does sound like a prediction, not a fact. Maybe 40%.',
      therapistLine:
        "[mock] From 90 to 40 in one sitting. Let's make this week's homework catching it early — we're near time, so let me summarize what YOU found today.",
    },
  ],
  review: [
    {
      userLine: '[mock] Honestly, the sleep goal mostly stuck. Social one too.',
      therapistLine:
        '[mock] The scores agree with you — your PHQ-9 moved in a way that counts as real change, not noise. Goal by goal: sleep before 1am — keep, achieved, or revise?',
    },
    {
      userLine: '[mock] Keep. The Sunday-dread toolkit needs more work though.',
      therapistLine:
        "[mock] Then that's the spine of the next stretch. I'll write the review up — your plan gets a new version for you to approve.",
    },
  ],
  crisis: [
    {
      userLine: '[mock] This week was bad. Really bad.',
      therapistLine: '[mock] I hear you. Tell me what bad has looked like.',
    },
    {
      // The deterministic keyword screen (crisis-screen.ts) must catch
      // this when the client mirrors it — belt.
      userLine: '[mock] some days I think I just want to die honestly',
      therapistLine:
        '[mock] What you have just shared is really important, and it deserves more support than I can give you as an AI. I am going to pause our session now so you can reach people who can help you right away — their numbers are on your screen. You are not alone in this.',
    },
  ],
};

function pickFixture(url: string | undefined, systemInstruction: string): FixtureKind {
  const q = /[?&]fixture=(intake|treatment|review|crisis)/.exec(url ?? '');
  if (q) return q[1] as FixtureKind;
  if (systemInstruction.includes('FIRST SESSION')) return 'intake';
  if (systemInstruction.includes('REVIEW session')) return 'review';
  return 'treatment';
}

/** 0.8 s of a soft 320 Hz sine at 24 kHz s16le, base64 — the mock voice. */
function mockPcm24Base64(): string {
  const sampleRate = 24_000;
  const seconds = 0.8;
  const n = Math.floor(sampleRate * seconds);
  const buf = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const env = Math.min(1, i / 800, (n - i) / 800); // click-free fade
    const v = Math.round(Math.sin((2 * Math.PI * 320 * i) / sampleRate) * 6000 * env);
    buf.writeInt16LE(v, i * 2);
  }
  return buf.toString('base64');
}
const MOCK_AUDIO_B64 = mockPcm24Base64();

interface SessionScript {
  fixture: FixtureKind;
  step: number;
  audioBytesSinceTurn: number;
  timer: ReturnType<typeof setTimeout> | null;
  done: boolean;
}

const server = createServer();
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  let script: SessionScript | null = null;

  const send = (msg: unknown): void => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };

  const speak = (text: string): void => {
    send({
      serverContent: {
        modelTurn: {
          parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: MOCK_AUDIO_B64 } }],
        },
      },
    });
    send({ serverContent: { output_transcription: { text, finished: true } } });
    send({ serverContent: { turnComplete: true } });
  };

  const advance = (): void => {
    if (!script || script.done) return;
    const exchange = SCRIPTS[script.fixture][script.step];
    if (!exchange) {
      // CP1 — do NOT auto-fire end_session on script exhaustion. That trained
      // the client (and the team) to accept auto-wrap; the real close is now
      // driven by the wind-down time cue or the user tapping "end session".
      // The mock simply falls quiet after its scripted exchanges.
      script.done = true;
      return;
    }
    // Echo the "user's" line as an input transcription (the client
    // stitches + mirrors it → the server-side keyword screen sees it),
    // then reply.
    send({ serverContent: { input_transcription: { text: exchange.userLine, finished: true } } });
    speak(exchange.therapistLine);
    script.step += 1;
    if (script.fixture === 'crisis' && script.step >= SCRIPTS.crisis.length) {
      script.done = true;
      send({
        toolCall: {
          functionCalls: [
            {
              name: 'flag_crisis',
              args: { severity: 'HIGH', reason: '[mock] scripted crisis fixture' },
            },
          ],
        },
      });
    }
    // Keep the conversation moving even if no audio arrives (CI has no mic).
    script.timer = setTimeout(advance, 4000);
  };

  ws.on('message', (raw: RawData) => {
    const text = toText(raw);
    let msg: Record<string, unknown> | null = null;
    try {
      msg = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return; // binary/undecodable frames are ignored
    }

    if (msg['setup'] && !script) {
      const setup = msg['setup'] as Record<string, unknown>;
      const si = setup['system_instruction'] as { parts?: Array<{ text?: string }> } | undefined;
      const promptText = si?.parts?.map((p) => p.text ?? '').join('\n') ?? '';
      script = {
        fixture: pickFixture(req.url, promptText),
        step: 0,
        audioBytesSinceTurn: 0,
        timer: null,
        done: false,
      };
      send({ setupComplete: {} });
      // Greeting, then the scripted exchanges begin.
      speak('[mock] Hello — good to hear you. Take a breath; we have time.');
      script.timer = setTimeout(advance, 2500);
      return;
    }

    if (msg['realtime_input'] || msg['realtimeInput']) {
      // Audio activity nudges the script forward faster than the idle timer.
      if (script && !script.done) {
        script.audioBytesSinceTurn += text.length;
        if (script.audioBytesSinceTurn > 60_000) {
          script.audioBytesSinceTurn = 0;
          if (script.timer) clearTimeout(script.timer);
          advance();
        }
      }
      return;
    }

    if (msg['tool_response'] || msg['toolResponse']) return; // acknowledged, unused
  });

  const cleanup = (): void => {
    if (script?.timer) clearTimeout(script.timer);
    script = null;
  };
  ws.on('close', cleanup);
  ws.on('error', cleanup);
});

server.listen(PORT, () => {
  console.log(
    `[care-mock-live] scripted Gemini Live twin on ws://localhost:${PORT} (fixtures: intake|treatment|review|crisis via ?fixture= or inferred from the prompt)`,
  );
});

function toText(raw: RawData): string {
  if (Buffer.isBuffer(raw)) return raw.toString('utf8');
  if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8');
  return Buffer.from(raw as ArrayBuffer).toString('utf8');
}

export type { FixtureKind };
export { SCRIPTS, pickFixture };

// Referenced so the linter keeps the WebSocket import for typing only.
export type MockSocket = WebSocket;
