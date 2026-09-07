/**
 * Actual React + application CSS capture-control smoke in isolated Chromium.
 * Capture hooks, wake lock, recovery storage, socket, API and ancillary rails are mocked.
 * No application server, login, database, audio device or external service is used.
 * Run: node scripts/test-mind-capture-browser.mjs (Node >=22.12; existing Chromium).
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
      import { LiveRecorder } from './components/app/LiveRecorder';
      const root = createRoot(document.getElementById('root'));
      let mount = 0;
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
        static OPEN = 1; OPEN = 1; readyState = 0;
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
          if (message.type === 'start') queueMicrotask(() => this.emit({ type: 'status', state: 'listening' }));
        }
        emit(event) { this.onmessage?.({ data: JSON.stringify(event) }); }
        close() { this.readyState = 3; }
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
        if (endpoint === 'capture-resume' && f.behavior.denyResume)
          return new Response(JSON.stringify({ error: 'Synthetic consent changed. Review consent before resuming.' }), { status: 409 });
        return new Response(JSON.stringify(endpoint === 'live-token' ? { token: 'synthetic-token' } : { ok: true }), { status: 200 });
      };
      window.mountCase = (kind, behavior = {}) => {
        flushSync(() => root.render(null));
        const f = window.fixture = { behavior, calls: [], events: [], commands: [], sockets: [], routes: [],
          starts: 0, frames: 0, active: false, activeChanges: [], finished: 0 };
        const key = ++mount;
        flushSync(() => root.render(<div data-mount={key}>
          {kind === 'live' ? <TherapistLiveSession sessionId="fictional-session" clientId="fictional-client"
            clientName="Fictional test client" sessionStatus="IN_PROGRESS" kind="TREATMENT" modality={null}
            language="en" autoStart={false} /> : <LiveRecorder sessionId="fictional-session"
              clientId="fictional-client" clientName="Fictional test client" modality={null} source="mic"
              onFinished={() => f.finished++} onActiveChange={active => f.activeChanges.push(active)} />}
        </div>));
        return key;
      };
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
            /^\.\/(GatewayMockBanner|TherapyCopilotRail|MindTherapyGuide|InRoomDirection)$/.test(
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
    return { starts, frames, active, events, commands, calls, routes, activeChanges, finished };
  });
}
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
async function test(name, run) {
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
  assert.deepEqual(errors, [], 'No uncaught browser errors');
  assert.deepEqual(requests, [], 'No browser network requests escaped mocks');
  assert.equal(await page.evaluate(() => window.deviceCalls), 0, 'No real device requests');
  console.log(
    passed + ' actual-React capture browser checks passed; all media/socket/API boundaries mocked.',
  );
} finally {
  await browser.close();
}
