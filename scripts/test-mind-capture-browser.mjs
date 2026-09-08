/**
 * Actual React + application CSS capture-control smoke in isolated Chromium.
 * Capture hooks, wake lock, recovery storage, socket, API and ancillary rails are mocked.
 * No application server, login, database, audio device or external service is used.
 * Run: node scripts/test-mind-capture-browser.mjs (Node >=22.12; existing Chromium).
 * Optional focused run: MIND_CAPTURE_TEST_FILTER='renewal' node scripts/test-mind-capture-browser.mjs
 * This verifies component orchestration/UX, not real microphone or gateway delivery.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const web = join(root, 'apps/web');
const webRequire = createRequire(join(web, 'package.json'));
const serviceRequire = createRequire(join(root, 'services/pdf-generator-service/package.json'));
const { build } = createRequire(serviceRequire.resolve('tsx/package.json'))('esbuild');
const puppeteer = serviceRequire('puppeteer');
const executablePath = await puppeteer.executablePath();
assert.ok(existsSync(executablePath), 'Existing test Chromium is required.');
const stylesheet = await webRequire('postcss')([
  webRequire('@tailwindcss/postcss')({ base: web }),
  webRequire('autoprefixer')(),
]).process(readFileSync(join(web, 'app/globals.css'), 'utf8'), {
  from: join(web, 'app/globals.css'),
});

const mocks = {
  '@/lib/audio/use-live-stream': `
    import { useEffect, useRef, useState } from 'react';
    export function useLiveStream(options) {
      const [state, setState] = useState('idle');
      const owner = useRef(window.fixture);
      const latest = useRef(options); latest.current = options;
      useEffect(() => () => { owner.current.active = false; }, []);
      return { state, error: null,
        start: async () => {
          const f = owner.current;
          f.events.push('live:capture-start'); f.active = true; f.starts++;
          f.frame = () => latest.current.onFrame(new Uint8Array([1, 2]));
          setState('recording');
        },
        stop: async () => {
          const f = owner.current;
          f.events.push('live:capture-stop');
          if (f.active && f.behavior.tailFrame) latest.current.onFrame(new Uint8Array([3, 4]));
          f.active = false; setState('idle');
        },
      };
    }
  `,
  '@/lib/audio/use-session-recorder': `
    import { useEffect, useRef, useState } from 'react';
    export function useSessionRecorder() {
      const [state, setState] = useState('idle');
      const owner = useRef(window.fixture);
      const started = useRef(Date.now() - 5000);
      useEffect(() => () => { owner.current.active = false; }, []);
      return { state, error: null, lastChunkIndex: 0, pendingCount: 0,
        draining: false, startedAt: started.current,
        start: async () => {
          const f = owner.current;
          f.events.push('batch:capture-start'); f.starts++; f.active = true;
          setState('recording');
        },
        pause: async () => {
          const f = owner.current;
          f.events.push('batch:capture-pause'); f.active = false; setState('pausing');
          if (f.behavior.deferBatchPause) await new Promise(resolve => { f.releasePause = resolve; });
          setState('paused');
        },
        stop: async () => {
          const f = owner.current; f.events.push('batch:capture-stop');
          f.active = false; setState('idle');
        },
        drainPending: async () => 0,
      };
    }
  `,
  '@/lib/audio/use-wake-lock': 'export function useWakeLock() {}',
  '@/lib/audio/idb-chunk-store':
    'export const SessionStore = { clear: async () => { throw new Error("Unexpected durable storage mutation"); } };',
  '@/lib/live-recovery-draft': `
    export const browserRecoveryStorage = () => ({});
    export const loadRecoveryDraft = () => null;
    export const saveRecoveryDraft = () => true;
    export const clearRecoveryDraftAfterDurableSave = () => true;
    export const shouldResumeRecovery = (count, requested) => requested || count > 0;
  `,
  'next/navigation':
    'export const useRouter = () => ({ push: path => { window.fixture.routes.push(path); } });',
  'next/link':
    'import React from "react"; export default function Link({ children, ...props }) { return <a {...props}>{children}</a>; }',
};
const bundle = await build({
  stdin: {
    resolveDir: web,
    loader: 'tsx',
    contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { flushSync } from 'react-dom';
      import { TherapistLiveSession } from './components/app/TherapistLiveSession';
      import { DoctorLiveEncounter } from './components/app/DoctorLiveEncounter';
      import { LiveRecorder } from './components/app/LiveRecorder';
      const root = createRoot(document.getElementById('root'));
      let mount = 0;
      // Keep React's short scheduling timers real. Only application deadlines
      // are advanced; no five-minute sleep or real token service is needed.
      const realNow = Date.now.bind(Date);
      const realTimeout = window.setTimeout.bind(window);
      const realClearTimeout = window.clearTimeout.bind(window);
      let clockNow = realNow();
      let timerId = 1000000;
      const deadlines = new Map();
      Date.now = () => clockNow;
      window.setTimeout = (callback, delay = 0, ...args) => {
        if (delay < 1000) return realTimeout(callback, delay, ...args);
        const id = ++timerId;
        deadlines.set(id, { at: clockNow + delay, callback: () => callback(...args) });
        return id;
      };
      window.clearTimeout = id => { deadlines.delete(id); realClearTimeout(id); };
      window.advanceClock = async ms => {
        const until = clockNow + ms;
        for (let steps = 0; steps < 1000; steps++) {
          const next = [...deadlines].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
          if (!next) { clockNow = until; await new Promise(resolve => realTimeout(resolve, 0)); return; }
          deadlines.delete(next[0]); clockNow = next[1].at; next[1].callback();
          // Drain async fetch/json continuations and React render scheduling.
          await new Promise(resolve => realTimeout(resolve, 0));
          await new Promise(resolve => realTimeout(resolve, 0));
        }
        throw new Error('Synthetic clock timer loop');
      };
      // about:blank is not a secure context; supply fixture-only UUIDs for the
      // protocol correlation code that uses crypto.randomUUID on HTTPS in-app.
      let uuid = 0;
      if (!crypto.randomUUID) Object.defineProperty(crypto, 'randomUUID', {
        value: () => '00000000-0000-4000-8000-' + String(++uuid).padStart(12, '0'),
      });
      window.deviceCalls = 0;
      const forbiddenDevice = () => { window.deviceCalls++; throw new Error('Real media device access is forbidden'); };
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
        getUserMedia: forbiddenDevice, getDisplayMedia: forbiddenDevice,
        enumerateDevices: forbiddenDevice,
      } });
      class Socket {
        static OPEN = 1; OPEN = 1; readyState = 0; bufferedAmount = 0;
        constructor(url) {
          const f = this.owner = window.fixture;
          if (url !== 'wss://mock.invalid/live') throw new Error('Unexpected socket URL');
          f.sockets.push(this);
          queueMicrotask(() => { if (this.readyState !== 0) return; this.readyState = 1; this.onopen?.(); });
        }
        send(data) {
          const f = this.owner;
          if (typeof data !== 'string') { f.frames++; f.events.push('socket:audio'); return; }
          const message = JSON.parse(data);
          f.commands.push(message); f.events.push('socket:' + message.type);
          if (message.type === 'start' && !f.behavior.deferListening)
            queueMicrotask(() => this.emit({ type: 'status', state: 'listening' }));
          if (message.type === 'renewToken' && !f.behavior.deferRenewAck)
            queueMicrotask(() => this.emit({ type: 'tokenRenewed', requestId: message.requestId, expiresAt: Math.floor(Date.now() / 1000) + 300 }));
        }
        emit(event) { this.onmessage?.({ data: JSON.stringify(event) }); }
        close() {
          if (this.readyState === 3) return;
          this.readyState = 3;
          queueMicrotask(() => this.onclose?.({ code: 1000, reason: 'Synthetic close' }));
        }
      }
      window.WebSocket = Socket;
      window.fetch = async (url, options = {}) => {
        const f = window.fixture;
        const endpoint = String(url).split('/').pop();
        f.calls.push({ url: String(url), method: options.method ?? 'GET' });
        f.events.push('api:' + endpoint);
        if (!String(url).startsWith('/api/v1/sessions/fictional-session/')) throw new Error('Unexpected API URL');
        if (!['live-token', 'start', 'capture-resume'].includes(endpoint)) throw new Error('Unexpected finalization or API request: ' + endpoint);
        if (endpoint === 'capture-resume' && f.behavior.deferResume) await new Promise(resolve => { f.releaseResume = resolve; });
        if (endpoint === 'live-token' && f.behavior.deferToken) await new Promise(resolve => { f.releaseToken = resolve; });
        if (endpoint === 'live-token' && f.calls.filter(call => call.url.endsWith('/live-token')).length > 1) {
          if (f.behavior.deferRenewToken) await new Promise(resolve => { f.releaseRenewToken = resolve; });
          if (f.behavior.denyRenewToken) return new Response(JSON.stringify({ error: 'Synthetic renewed consent denied.' }), { status: 403 });
        }
        if (endpoint === 'capture-resume' && f.behavior.denyResume)
          return new Response(JSON.stringify({ error: 'Synthetic consent changed. Review consent before resuming.' }), { status: 409 });
        return new Response(JSON.stringify(endpoint === 'live-token' ? { token: 'synthetic-token', expiresInSec: 300 } : { ok: true }), { status: 200 });
      };
      window.mountCase = (kind, behavior = {}) => {
        flushSync(() => root.render(null));
        deadlines.clear(); clockNow = realNow();
        const f = window.fixture = { behavior, calls: [], events: [], commands: [], sockets: [], routes: [],
          starts: 0, frames: 0, active: false, activeChanges: [], finished: 0 };
        const key = ++mount;
        flushSync(() => root.render(<div data-mount={key}>
          {kind === 'live' ? <TherapistLiveSession sessionId="fictional-session" clientId="fictional-client"
            clientName="Fictional test client" sessionStatus="IN_PROGRESS" kind="TREATMENT" modality={null}
            language="en" autoStart={false} /> : kind === 'doctor' ? <DoctorLiveEncounter
              sessionId="fictional-session" patient={{ name: 'Fictional test patient' }} autoStart={false} /> : <LiveRecorder sessionId="fictional-session"
              clientId="fictional-client" clientName="Fictional test client" modality={null} source="mic"
              onFinished={() => f.finished++} onActiveChange={active => f.activeChanges.push(active)} />}
        </div>));
        return key;
      };
      window.unmountCase = () => flushSync(() => root.render(null));
      window.emitTranscript = () => window.fixture.sockets.at(-1).emit({ type: 'utterance', utterance: {
        id: 'fictional-utterance', speaker: 'patient', text: 'Synthetic words retained across renewal.', tStartMs: 0, tEndMs: 1000,
      } });
      window.replyToPause = (type, stale = false) => {
        const f = window.fixture;
        const command = f.commands.filter(value => value.type === 'pause').at(-1);
        f.sockets.at(-1).emit({ type, requestId: stale ? '00000000-0000-4000-8000-999999999999' : command.requestId });
      };
    `,
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  define: {
    'process.env.NODE_ENV': '"development"',
    'process.env.NEXT_PUBLIC_LIVE_GATEWAY_URL': '"wss://mock.invalid/live"',
  },
  alias: { '@': web },
  plugins: [
    {
      name: 'isolated-capture-boundaries',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, ({ path }) => {
          if (path in mocks) return { path, namespace: 'mock-capture' };
          if (
            /^\.\/(GatewayMockBanner|TherapyCopilotRail|MindTherapyGuide|InRoomDirection|ReviewAndSign|TurnoverBar)$/.test(
              path,
            )
          )
            return { path: path.slice(2), namespace: 'mock-rail' };
        });
        builder.onLoad({ filter: /.*/, namespace: 'mock-capture' }, ({ path }) => ({
          resolveDir: web,
          loader: 'jsx',
          contents: mocks[path],
        }));
        builder.onLoad({ filter: /.*/, namespace: 'mock-rail' }, ({ path }) => ({
          contents: 'export function ' + path + '() { return null; }',
        }));
      },
    },
  ],
});

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  pipe: true,
  args: [
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--no-first-run',
  ],
});
const page = await browser.newPage();
const errors = [],
  requests = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.setRequestInterception(true);
page.on('request', (request) => {
  requests.push(request.url());
  void request.abort();
});
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
await page.setContent(
  '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'"><main id="root"></main>',
);
await page.addStyleTag({ content: stylesheet.css });
await page.addScriptTag({ content: bundle.outputFiles[0].text });
page.setDefaultTimeout(5000);
const text = (needle) =>
  page.waitForFunction((value) => document.body.textContent.includes(value), {}, needle);
async function mount(kind, behavior = {}) {
  const id = await page.evaluate(
    (kind, behavior) => window.mountCase(kind, behavior),
    kind,
    behavior,
  );
  await page.waitForSelector('[data-mount="' + id + '"]');
}
async function button(label) {
  for (const handle of await page.$$('button')) {
    if (await handle.evaluate((el, value) => el.textContent.trim() === value, label)) return handle;
    await handle.dispose();
  }
  return null;
}
async function click(label) {
  const handle = await button(label);
  assert.ok(handle, 'Button exists: ' + label);
  assert.equal(await handle.evaluate((el) => el.disabled), false, 'Button enabled: ' + label);
  await handle.click();
  await handle.dispose();
}
async function missing(label) {
  const handle = await button(label);
  assert.equal(handle, null, 'Button absent: ' + label);
}
async function snapshot() {
  return page.evaluate(() => {
    const { starts, frames, active, events, commands, calls, routes, activeChanges, finished } =
      window.fixture;
    return {
      starts,
      frames,
      active,
      events,
      commands,
      calls,
      routes,
      activeChanges,
      finished,
      sockets: window.fixture.sockets.length,
    };
  });
}
async function advance(ms) {
  await page.evaluate((ms) => window.advanceClock(ms), ms);
}
async function startLive(kind = 'live', behavior = {}) {
  await mount(kind, behavior);
  await click(kind === 'doctor' ? '● Start live consult' : 'Start session');
  await text(kind === 'doctor' ? 'End & review note' : 'Pause recording');
  await page.evaluate(() => window.emitTranscript());
  if (kind === 'live') await click('Show transcript');
  await text('Synthetic words retained across renewal.');
}
const tokenCallCount = (f) => f.calls.filter((call) => call.url.endsWith('/live-token')).length;
const renewalCommands = (f) => f.commands.filter((command) => command.type === 'renewToken');
async function pauseLive() {
  await click('Pause recording');
  await page.waitForFunction(() =>
    window.fixture.commands.some((command) => command.type === 'pause'),
  );
  await text('Microphone off · confirming the last audio…');
}
async function assertNotFinalized() {
  const f = await snapshot();
  assert.equal(
    f.commands.some((command) => ['stop', 'finalize'].includes(command.type)),
    false,
  );
  assert.equal(
    f.calls.some((call) => /\/(end|live-note|generate-note)$/.test(call.url)),
    false,
  );
  assert.deepEqual(f.routes, []);
  assert.equal(f.finished, 0);
}
let passed = 0;
const testFilter = process.env.MIND_CAPTURE_TEST_FILTER
  ? new RegExp(process.env.MIND_CAPTURE_TEST_FILTER)
  : null;
async function test(name, run) {
  if (testFilter && !testFilter.test(name)) return;
  try {
    await run();
    passed++;
    console.log('PASS ' + name);
  } catch (error) {
    console.error('FAIL ' + name, await snapshot());
    console.error(await page.evaluate(() => document.body.innerText));
    throw error;
  }
}
try {
  await test('mobile live entry exposes a visible keyboard-operable Start without auto capture', async () => {
    await mount('live');
    const handle = await button('Start session');
    assert.ok(handle);
    assert.equal(
      await handle.evaluate((el) => {
        const box = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return (
          !!el.closest('header') &&
          style.visibility === 'visible' &&
          style.display !== 'none' &&
          box.width > 0 &&
          box.height > 0 &&
          box.left >= 0 &&
          box.right <= innerWidth &&
          box.top >= 0 &&
          box.bottom <= innerHeight
        );
      }),
      true,
    );
    assert.equal((await snapshot()).starts, 0);
    assert.deepEqual((await snapshot()).calls, []);
    await handle.focus();
    await page.keyboard.press('Enter');
    await text('Pause recording');
    assert.equal((await snapshot()).starts, 1);
    assert.equal((await snapshot()).active, true);
    const events = (await snapshot()).events;
    assert.ok(events.indexOf('api:live-token') < events.indexOf('live:capture-start'));
  });
  await test('live pause drains a final frame, ignores stale ACK, and resumes only after matching ACK', async () => {
    await mount('live', { tailFrame: true });
    await click('Start session');
    await text('Pause recording');
    await pauseLive();
    let f = await snapshot();
    assert.equal(f.active, false);
    assert.ok(f.events.indexOf('socket:audio') < f.events.indexOf('socket:pause'));
    await missing('Resume recording');
    await page.evaluate(() => window.replyToPause('capturePaused', true));
    await text('Microphone off · confirming the last audio…');
    await missing('Resume recording');
    await page.evaluate(() => window.replyToPause('capturePaused'));
    await text('Microphone off · recording paused');
    await text('This session has not ended');
    const frames = (await snapshot()).frames;
    await page.evaluate(() => window.fixture.frame());
    assert.equal((await snapshot()).frames, frames, 'Late frames cannot be sent while paused');
    await click('End session');
    await text('End this session?');
    await click('Stay paused');
    await text('Microphone off · recording paused');
    await page.evaluate(() => {
      window.fixture.behavior.deferToken = true;
    });
    await click('Resume recording');
    await page.waitForFunction(() => !!window.fixture.releaseToken);
    await text('Connecting capture…');
    assert.equal((await snapshot()).starts, 1);
    assert.equal((await snapshot()).active, false);
    await page.evaluate(() => window.fixture.releaseToken());
    await text('Pause recording');
    f = await snapshot();
    assert.equal(f.starts, 2);
    assert.equal(f.active, true);
    assert.deepEqual(
      f.commands.filter((command) => command.type === 'start').map((command) => command.sessionId),
      ['fictional-session', 'fictional-session'],
    );
    await assertNotFinalized();
  });
  await test('live negative pause ACK leaves capture off and an explicit retry without a Resume shortcut', async () => {
    await mount('live');
    await click('Start session');
    await text('Pause recording');
    await pauseLive();
    await page.evaluate(() => window.replyToPause('capturePauseFailed'));
    await text('Microphone off · pause not confirmed');
    await missing('Resume recording');
    assert.equal((await snapshot()).active, false);
    const prior = (await snapshot()).commands.at(-1).requestId;
    await click('Retry pause confirmation');
    await page.waitForFunction(
      () => window.fixture.commands.filter((command) => command.type === 'pause').length === 2,
    );
    assert.notEqual((await snapshot()).commands.at(-1).requestId, prior);
    await page.evaluate(() => window.replyToPause('capturePaused'));
    await text('Microphone off · recording paused');
    assert.ok(await button('Resume recording'));
    await assertNotFinalized();
  });
  await test('batch pause waits for the tail save, keeps the session guard active, and can stay paused', async () => {
    await mount('batch', { deferBatchPause: true });
    await text('Pause recording');
    assert.equal(
      (await snapshot()).starts,
      1,
      'Batch mount follows the already-confirmed recording wizard',
    );
    await click('Pause recording');
    await text('Microphone off · saving the last audio…');
    assert.equal((await snapshot()).active, false);
    await missing('Resume recording');
    assert.equal(await (await button('End session')).evaluate((el) => el.disabled), true);
    await page.evaluate(() => window.fixture.releasePause());
    await text('Microphone off · capture paused');
    await text('Session elapsed · includes breaks');
    assert.equal((await snapshot()).activeChanges.at(-1), true);
    await click('End session');
    await text('End this session?');
    await click('Stay paused');
    await text('Microphone off · capture paused');
    assert.equal((await snapshot()).starts, 1);
    await assertNotFinalized();
  });
  await test('batch resume waits for renewed authorization before restarting capture', async () => {
    await mount('batch', { deferResume: true });
    await text('Pause recording');
    await click('Pause recording');
    await text('Microphone off · capture paused');
    await click('Resume recording');
    await page.waitForFunction(() => !!window.fixture.releaseResume);
    await text('Resuming capture…');
    assert.equal((await snapshot()).active, false);
    assert.equal((await snapshot()).starts, 1);
    assert.equal(await (await button('Resuming…')).evaluate((el) => el.disabled), true);
    assert.equal(await (await button('End session')).evaluate((el) => el.disabled), true);
    await page.evaluate(() => window.fixture.releaseResume());
    await text('Pause recording');
    const f = await snapshot();
    assert.equal(f.starts, 2);
    assert.equal(f.active, true);
    assert.ok(f.events.indexOf('api:capture-resume') < f.events.lastIndexOf('batch:capture-start'));
    await assertNotFinalized();
  });
  await test('batch denied resume remains paused with a retryable error and no new capture', async () => {
    await mount('batch', { denyResume: true });
    await text('Pause recording');
    await click('Pause recording');
    await text('Microphone off · capture paused');
    await click('Resume recording');
    await text('Synthetic consent changed. Review consent before resuming.');
    assert.equal((await snapshot()).active, false);
    assert.equal((await snapshot()).starts, 1);
    assert.equal(await (await button('Resume recording')).evaluate((el) => el.disabled), false);
    await assertNotFinalized();
  });
  for (const kind of ['live', 'doctor']) {
    await test(
      kind + ' successful renewal beyond five minutes preserves the same capture and transcript',
      async () => {
        await startLive(kind);
        await advance(360_000);
        const f = await snapshot();
        assert.equal(tokenCallCount(f), 2);
        assert.equal(renewalCommands(f).length, 1);
        assert.equal(f.starts, 1, 'Renewal must not restart media');
        assert.equal(f.sockets, 1, 'Renewal must not reconnect');
        assert.equal(f.active, true);
        await text('Synthetic words retained across renewal.');
        const frames = f.frames;
        await page.evaluate(() => window.fixture.frame());
        assert.equal((await snapshot()).frames, frames + 1);
        await assertNotFinalized();
      },
    );
  }
  await test('denied therapist renewal stops capture with explicit recovery and intact transcript', async () => {
    await startLive('live', { denyRenewToken: true });
    await advance(240_000);
    await text('Live authorization could not be renewed. Microphone stopped.');
    await text('Synthetic words retained across renewal.');
    assert.ok(await button('Reconnect'));
    let f = await snapshot();
    assert.equal(f.active, false);
    assert.equal(f.starts, 1);
    assert.equal(tokenCallCount(f), 2);
    assert.equal(renewalCommands(f).length, 0);
    const frames = f.frames;
    await page.evaluate(() => window.fixture.frame());
    assert.equal((await snapshot()).frames, frames);
    await advance(360_000);
    f = await snapshot();
    assert.equal(tokenCallCount(f), 2, 'Failed renewal cannot retry automatically');
    assert.equal(f.starts, 1);
    await assertNotFinalized();
  });
  await test('doctor renewal failure and denied fresh resume cannot reuse a stale token or clear transcript', async () => {
    await startLive('doctor', { denyRenewToken: true });
    await advance(240_000);
    await text('Live authorization could not be renewed. Microphone stopped.');
    await text('Synthetic words retained across renewal.');
    assert.ok(await button('Resume live consult'));
    assert.ok(await button('Review captured note'));
    let f = await snapshot();
    assert.equal(f.active, false);
    assert.equal(f.starts, 1);
    const frames = f.frames;
    await page.evaluate(() => window.fixture.frame());
    assert.equal((await snapshot()).frames, frames);
    await click('Resume live consult');
    await text('Synthetic renewed consent denied.');
    await text('Synthetic words retained across renewal.');
    f = await snapshot();
    assert.equal(tokenCallCount(f), 3);
    assert.equal(f.sockets, 1, 'A refused mint must not open a socket with the old token');
    assert.equal(f.starts, 1);
    assert.equal(f.active, false);
    await advance(360_000);
    assert.equal(tokenCallCount(await snapshot()), 3, 'No automatic authorization retries');
    await page.evaluate(() => {
      window.fixture.behavior.denyRenewToken = false;
    });
    await click('Resume live consult');
    await text('End & review note');
    await text('Synthetic words retained across renewal.');
    f = await snapshot();
    assert.equal(f.starts, 2);
    assert.equal(f.active, true);
    assert.equal(f.sockets, 2);
    assert.equal(
      f.commands.filter((command) => command.type === 'start').at(-1).resume.utterances[0].text,
      'Synthetic words retained across renewal.',
    );
    await assertNotFinalized();
  });
  await test('doctor reconnect readiness timeout stops capture and stale ready cannot affect its replacement', async () => {
    await startLive('doctor');
    await page.evaluate(() => {
      window.fixture.behavior.deferListening = true;
      window.fixture.sockets[0].close();
    });
    await page.waitForFunction(
      () =>
        window.fixture.sockets.length === 2 &&
        window.fixture.commands.filter((command) => command.type === 'start').length === 2,
    );
    assert.equal(
      (await snapshot()).active,
      true,
      'Reconnect holds capture only within its readiness budget',
    );
    await advance(20_001);
    await text('The live gateway did not confirm capture readiness. Microphone stopped.');
    await text('Synthetic words retained across renewal.');
    assert.equal((await snapshot()).active, false);
    assert.equal((await snapshot()).starts, 1);
    await page.evaluate(() => {
      window.fixture.sockets[1].emit({ type: 'status', state: 'listening' });
    });
    assert.equal(
      (await snapshot()).active,
      false,
      'Expired socket readiness cannot reactivate capture',
    );
    await page.evaluate(() => {
      window.fixture.behavior.deferListening = false;
    });
    await click('Resume live consult');
    await text('End & review note');
    const before = await snapshot();
    assert.equal(before.starts, 2);
    assert.equal(before.active, true);
    assert.equal(before.sockets, 3);
    await page.evaluate(() => {
      window.fixture.sockets[1].emit({ type: 'status', state: 'listening' });
      window.fixture.sockets[1].onclose?.({ code: 1000, reason: 'Synthetic delayed close' });
    });
    await advance(20_001);
    const after = await snapshot();
    assert.equal(after.starts, 2);
    assert.equal(after.active, true);
    assert.equal(after.sockets, 3);
    assert.equal(tokenCallCount(after), tokenCallCount(before));
    await text('Synthetic words retained across renewal.');
    await assertNotFinalized();
  });
  await test('stale renewal acknowledgment cannot prevent fail-closed timeout', async () => {
    await startLive('live', { deferRenewAck: true });
    await advance(240_000);
    assert.equal(renewalCommands(await snapshot()).length, 1);
    await page.evaluate(() =>
      window.fixture.sockets.at(-1).emit({
        type: 'tokenRenewed',
        requestId: '00000000-0000-4000-8000-999999999999',
        expiresAt: Math.floor(Date.now() / 1000) + 300,
      }),
    );
    await advance(20_001);
    await text('Live authorization could not be renewed. Microphone stopped.');
    await text('Synthetic words retained across renewal.');
    assert.equal((await snapshot()).active, false);
    assert.equal((await snapshot()).starts, 1);
    await assertNotFinalized();
  });
  await test('renewal failure while paused stays off and requires explicit Resume', async () => {
    await startLive('live', { denyRenewToken: true });
    await pauseLive();
    await page.evaluate(() => window.replyToPause('capturePaused'));
    await text('Microphone off · recording paused');
    await advance(240_000);
    await text('Resume explicitly to recheck access and consent.');
    await text('Synthetic words retained across renewal.');
    assert.ok(await button('Resume recording'));
    assert.equal((await snapshot()).active, false);
    assert.equal((await snapshot()).starts, 1);
    await advance(360_000);
    assert.equal(tokenCallCount(await snapshot()), 2);
    await assertNotFinalized();
    await page.evaluate(() => {
      window.fixture.behavior.denyRenewToken = false;
    });
    await click('Resume recording');
    await text('Pause recording');
    const resumed = await snapshot();
    assert.equal(resumed.starts, 2);
    assert.equal(resumed.active, true);
    assert.equal(
      resumed.commands.filter((command) => command.type === 'start').at(-1).resume.utterances[0]
        .text,
      'Synthetic words retained across renewal.',
    );
  });
  for (const kind of ['live', 'doctor']) {
    await test(
      kind + ' unmount disposes in-flight renewal and ignores its late response',
      async () => {
        await startLive(kind, { deferRenewToken: true });
        await advance(240_000);
        await page.waitForFunction(() => !!window.fixture.releaseRenewToken);
        await page.evaluate(() => window.unmountCase());
        const before = await snapshot();
        assert.equal(before.active, false);
        await page.evaluate(() => window.fixture.releaseRenewToken());
        await advance(360_000);
        const after = await snapshot();
        assert.equal(after.starts, before.starts);
        assert.equal(after.active, false);
        assert.equal(renewalCommands(after).length, 0);
        assert.equal(tokenCallCount(after), tokenCallCount(before));
        assert.equal(
          after.events.filter((event) => event === 'live:capture-stop').length,
          before.events.filter((event) => event === 'live:capture-stop').length,
          'Disposed renewal must not invoke its old failure callback',
        );
      },
    );
  }
  await test('End disposes an in-flight renewal before its late response can send another command', async () => {
    await startLive('live', { deferRenewToken: true });
    await advance(240_000);
    await page.waitForFunction(() => !!window.fixture.releaseRenewToken);
    await click('End session');
    await click('End & save');
    await page.waitForFunction(() =>
      window.fixture.commands.some((command) => command.type === 'stop'),
    );
    const before = await snapshot();
    assert.equal(before.active, false);
    await page.evaluate(() => window.fixture.releaseRenewToken());
    await advance(360_000);
    const after = await snapshot();
    assert.equal(after.active, false);
    assert.equal(after.starts, 1);
    assert.equal(tokenCallCount(after), tokenCallCount(before));
    assert.equal(renewalCommands(after).length, 0);
    assert.equal(
      after.events.filter((event) => event === 'live:capture-stop').length,
      before.events.filter((event) => event === 'live:capture-stop').length,
    );
  });
  assert.deepEqual(errors, [], 'No uncaught browser errors');
  assert.ok(passed > 0, 'At least one browser check must run');
  assert.deepEqual(requests, [], 'No browser network requests escaped mocks');
  assert.equal(await page.evaluate(() => window.deviceCalls), 0, 'No real device requests');
  console.log(
    passed + ' actual-React capture browser checks passed; all media/socket/API boundaries mocked.',
  );
} finally {
  await browser.close();
}
