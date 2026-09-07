/** Real React entry regressions with fictional data, no app, microphone, DB or network. */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const web = join(root, 'apps/web');
const serviceRequire = createRequire(join(root, 'services/pdf-generator-service/package.json'));
const { build } = createRequire(serviceRequire.resolve('tsx/package.json'))('esbuild');
const puppeteer = serviceRequire('puppeteer');
const executablePath = await puppeteer.executablePath();
assert.ok(existsSync(executablePath), `Test Chromium missing: ${executablePath}`);

const bundle = await build({
  stdin: {
    resolveDir: web,
    loader: 'tsx',
    contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { RecordingShell } from './components/app/RecordingShell';
      const root = createRoot(document.getElementById('root'));
      window.calls = []; window.routes = []; window.behavior = {};
      window.fetch = async (url, options = {}) => {
        const body = options.body ? JSON.parse(options.body) : null;
        window.calls.push({ url, method: options.method || 'GET', body });
        const reply = (body, status = 200) => new Response(JSON.stringify(body), { status });
        if (String(url).includes('session-defaults?guides=1')) {
          if (window.behavior.guideFailure) return reply({ error: 'Unavailable' }, 503);
          const client = String(url).includes('client-a') ? 'a' : 'b';
          return reply({ guides: [{ id: 'guide-' + client, name: 'Prepared guide ' + client.toUpperCase(), updatedAt: '2026-09-07T10:00:00.000Z' }] });
        }
        if (String(url).endsWith('session-defaults')) return reply({ defaults: {
          kind: 'TREATMENT', modality: 'CBT', modalitySource: 'client', language: 'en',
          lastCompletedSessionAt: null, consentsNeeded: [], consentsAlreadyGranted: ['AUDIO_RECORDING', 'AI_NOTE_GENERATION', 'CROSS_BORDER_PROCESSING'],
        } });
        if (url === '/api/v1/sessions') {
          const result = () => reply({ id: body.expectedSessionId || 'booking-b', clientId: body.clientId, kind: 'TREATMENT', modality: 'CBT', status: 'SCHEDULED' });
          if (window.behavior.deferStart) return new Promise(resolve => { window.resolveStart = () => resolve(result()); window.startSignal = options.signal; });
          return result();
        }
        if (String(url).endsWith('/consent')) return reply({ ok: true });
        throw new Error('Unexpected mock request: ' + url);
      };
      const clients = [
        { id: 'client-a', fullName: 'Asha Example', preferredModality: null, lastCompletedSessionAt: null },
        { id: 'client-b', fullName: 'Beena Example', preferredModality: null, lastCompletedSessionAt: null },
      ];
      let mount = 0;
      window.mountCase = (kind, behavior = {}) => {
        window.calls = []; window.routes = []; window.behavior = behavior;
        const key = ++mount;
        root.render(<div key={key} data-case={key}><RecordingShell clients={clients}
          initialClientId={kind === 'booked' ? 'client-a' : null}
          initialSessionId={kind === 'booked' ? 'booking-a' : null}
          initialGuideId={kind === 'booked' ? 'guide-a' : undefined}
          defaultCapture="LIVE" videoEnabled={false} /></div>);
        return key;
      };
    `,
  },
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  jsx: 'automatic',
  alias: { '@': web },
  define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [
    {
      name: 'isolated-capture-and-next',
      setup(builder) {
        builder.onResolve({ filter: /^next\/(navigation|link)$/ }, ({ path }) => ({
          path,
          namespace: 'isolated',
        }));
        builder.onResolve(
          {
            filter:
              /^\.\/(MindSessionPreflight|PreparePanel|NewClientForm|LiveRecorder|FileUploadPanel|UpgradeModal)$/,
          },
          ({ path }) => ({ path, namespace: 'isolated' }),
        );
        builder.onResolve({ filter: /audio\/use-session-recorder$/ }, () => ({
          path: 'capture',
          namespace: 'isolated',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'isolated' }, ({ path }) => ({
          loader: 'jsx',
          resolveDir: web,
          contents:
            path === 'next/navigation'
              ? `export const useRouter = () => ({ push: url => window.routes.push(url), refresh: () => {} });`
              : path === 'next/link'
                ? `import React from 'react'; export default function Link({children, ...props}) { return <a {...props}>{children}</a>; }`
                : path === './MindSessionPreflight'
                  ? `import React, { useEffect } from 'react'; export function MindSessionPreflight({ enabled, onReadyChange }) { useEffect(() => { onReadyChange(enabled); }, [enabled, onReadyChange]); return enabled ? <p>Mock microphone ready</p> : null; }`
                  : path === './PreparePanel'
                    ? `import React from 'react'; export function PreparePanel({clientId, defaultOpen}) { return <p data-prepare-client={clientId} data-prepare-open={defaultOpen}>Optional preparation</p>; }`
                    : path === 'capture'
                      ? `export const isDisplayCaptureSupported = () => false;`
                      : `export function ${path.slice(2)}() { return null; }`,
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
try {
  const page = await browser.newPage();
  const errors = [];
  const external = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    if (request.url().startsWith('data:')) void request.continue();
    else {
      external.push(request.url());
      void request.abort();
    }
  });
  await page.setContent(
    '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'"><main id="root"></main>',
  );
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const click = async (label) => {
    for (const button of await page.$$('button')) {
      if ((await button.evaluate((node) => node.textContent.trim())) === label) {
        await button.click();
        return;
      }
    }
    throw new Error('Missing button: ' + label);
  };
  const mount = async (kind, behavior = {}) => {
    const key = await page.evaluate(
      (kind, behavior) => window.mountCase(kind, behavior),
      kind,
      behavior,
    );
    await page.waitForSelector('[data-case="' + key + '"]');
  };
  const ready = async () => {
    await page.waitForFunction(() => {
      const select = document.querySelector('#rcs-guide');
      return select && !document.body.textContent.includes('Checking previously prepared');
    });
  };
  const start = async () => {
    await page.click('#rcs-today-confirmation');
    await page.waitForFunction(() =>
      [...document.querySelectorAll('button')].some(
        (button) => button.textContent === 'Start recording' && !button.disabled,
      ),
    );
    await click('Start recording');
    await page.waitForFunction(() => window.routes.length > 0);
  };

  await mount('picker');
  assert.match(
    await page.$eval('main', (node) => node.textContent),
    /All clients[\s\S]*Asha Example[\s\S]*Beena Example/,
  );
  console.log('PASS existing clients remain browseable without a recent session or a search');

  await mount('booked');
  await ready();
  assert.equal(await page.$eval('#rcs-guide', (node) => node.value), 'guide-a');
  assert.equal(
    await page.$eval('[data-prepare-client]', (node) => node.dataset.prepareOpen),
    'true',
  );
  assert.equal(
    (await page.evaluate(() => window.calls.filter((call) => call.method === 'POST'))).length,
    0,
  );
  assert.equal(
    await page.$$eval(
      'button',
      (buttons) => buttons.find((button) => button.textContent === 'Start recording').disabled,
    ),
    true,
  );
  await start();
  let calls = await page.evaluate(() => window.calls);
  assert.equal(
    calls.find((call) => call.url === '/api/v1/sessions').body.expectedSessionId,
    'booking-a',
  );
  assert.match(
    (await page.evaluate(() => window.routes))[0],
    /\/booking-a\/live\?flash=1&guide=guide-a$/,
  );
  assert.ok(calls.some((call) => call.url === '/api/v1/sessions/booking-a/consent'));
  console.log(
    'PASS exact booking and prepared guide survive entry; explicit session consent remains required',
  );

  await mount('booked');
  await ready();
  await click('← Back');
  await page.waitForFunction(() => document.body.textContent.includes('Beena Example'));
  await page.evaluate(() =>
    [...document.querySelectorAll('button')]
      .find((button) => button.textContent.includes('Beena Example'))
      .click(),
  );
  await ready();
  assert.equal(await page.$eval('h2', (node) => node.textContent), 'Beena Example');
  assert.equal(await page.$eval('#rcs-guide', (node) => node.value), '');
  assert.equal(
    await page.$eval('[data-prepare-client]', (node) => node.dataset.prepareClient),
    'client-b',
  );
  await page.select('#rcs-guide', 'guide-b');
  await start();
  calls = await page.evaluate(() => window.calls);
  const request = calls.find((call) => call.url === '/api/v1/sessions');
  assert.equal(request.body.clientId, 'client-b');
  assert.equal('expectedSessionId' in request.body, false);
  assert.match(
    (await page.evaluate(() => window.routes))[0],
    /\/booking-b\/live\?flash=1&guide=guide-b$/,
  );
  assert.ok(!calls.some((call) => call.url.includes('booking-a/consent')));
  console.log('PASS A booking → Back → B uses B identity, not A booking or A guide');

  await mount('booked', { guideFailure: true });
  await ready();
  assert.match(
    await page.$eval('main', (node) => node.textContent),
    /Prepared guides could not be loaded/,
  );
  await start();
  assert.equal(
    (await page.evaluate(() => window.routes))[0],
    '/app/sessions/booking-a/live?flash=1',
  );
  console.log('PASS optional guide outage does not block a consented quiet-focus start');

  await mount('booked', { deferStart: true });
  await ready();
  await page.click('#rcs-today-confirmation');
  await page.waitForFunction(() =>
    [...document.querySelectorAll('button')].some(
      (button) => button.textContent === 'Start recording' && !button.disabled,
    ),
  );
  await click('Start recording');
  await page.waitForFunction(() => typeof window.resolveStart === 'function');
  assert.equal(
    await page.$$eval(
      'button',
      (buttons) => buttons.find((button) => button.textContent.trim() === '← Back').disabled,
    ),
    true,
  );
  await mount('picker');
  await page.evaluate(async () => {
    window.resolveStart();
    await Promise.resolve();
  });
  await page.waitForFunction(() => window.startSignal.aborted);
  assert.deepEqual(await page.evaluate(() => window.routes), []);
  assert.equal(
    (await page.evaluate(() => window.calls.filter((call) => call.url.endsWith('/consent'))))
      .length,
    0,
  );
  console.log('PASS an unmounted late start cannot consent, navigate or activate the old client');
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(
    '5 isolated React start journeys passed; no external requests, patient records or real microphone.',
  );
} finally {
  await browser.close();
}
