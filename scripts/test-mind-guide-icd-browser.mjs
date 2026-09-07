/** Isolated actual-React regressions; no app, auth, database or external network.
 * Run: node scripts/test-mind-guide-icd-browser.mjs (Node >=22.12; existing Chromium).
 */
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
assert.ok(existsSync(executablePath), 'Existing test Chromium is required.');
const bundle = await build({
  stdin: {
    resolveDir: web,
    loader: 'tsx',
    contents: `
      import React, { useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { MindTherapyGuide } from './components/app/MindTherapyGuide';
      import { Icd11Picker } from './components/app/Icd11Picker';
      const root = createRoot(document.getElementById('root'));
      const version = '2026-09-06T10:00:00.000Z';
      const script = { version: 'V1', therapyName: 'Synthetic guide', openingScript: 'Synthetic opening', mainExercise: { steps: [{ id: 'one', purpose: 'Synthetic exercise', therapistSays: 'Synthetic prompt', listenFor: '', branches: [] }] }, closingScript: 'Synthetic close', homework: { description: 'Synthetic next step', deliveryNotes: '' }, adaptationCues: [], riskWatchpoints: [], estimatedDurationMin: 20 };
      let mount = 0;
      function Picker() {
        const [code, setCode] = useState('6B00');
        const [label, setLabel] = useState('Old diagnosis label');
        return <form onSubmit={event => { event.preventDefault(); window.submits++; }}>
          <Icd11Picker code={code} onPick={entry => { setCode(entry.code); setLabel(entry.label); }}
            onCodeChange={value => { setCode(value); setLabel(''); }} />
          <output id="code">{code}</output><output id="label">{label}</output>
          <button type="button" id="outside">Another field</button>
        </form>;
      }
      window.fetch = async (url, options = {}) => {
        const body = options.body ? JSON.parse(options.body) : null;
        window.calls.push({ url, method: options.method ?? 'GET', body });
        if (!String(url).endsWith('/review')) throw new Error('Unexpected request');
        if (options.method === 'PATCH') {
          const commit = () => {
            if (window.behavior.failPatch) throw new Error('Synthetic offline');
            if (body.expectedRevision !== window.saved.revision) return new Response(JSON.stringify({ code: 'GUIDE_REVIEW_CONFLICT' }), { status: 409 });
            const { expectedRevision, ...snapshot } = body;
            window.saved = { ...snapshot, revision: expectedRevision + 1 };
            if (window.behavior.loseResponse) throw new Error('Synthetic lost response');
            return new Response(JSON.stringify({ progress: window.saved }), { status: 200 });
          };
          if (window.behavior.deferPatch) return new Promise((resolve, reject) => {
            window.releasePatch = () => { try { resolve(commit()); } catch (error) { reject(error); } };
          });
          return commit();
        }
        const read = () => new Response(JSON.stringify({ progress: window.saved, revision: window.saved.revision, scriptUpdatedAt: version }), { status: 200 });
        if (window.behavior.deferGet) return new Promise(resolve => { window.releaseGet = () => resolve(read()); });
        return read();
      };
      window.mountCase = (kind, behavior = {}) => {
        window.behavior = behavior; window.calls = []; window.submits = 0;
        window.saved = { version: 1, revision: 2, scriptUpdatedAt: version, activeIndex: 1, reviewedIndexes: [0] };
        window.releasePatch = null; window.releaseGet = null;
        const key = ++mount;
        root.render(<div key={key} data-mount={key}>{kind === 'picker' ? <Picker /> : <MindTherapyGuide script={script} reviewTarget={{ clientId: 'fictional-client', scriptId: 'fictional-guide', scriptUpdatedAt: version }} />}</div>);
        return key;
      };
    `,
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"' },
  alias: { '@': web },
  plugins: [
    {
      name: 'isolated-display',
      setup(builder) {
        builder.onResolve({ filter: /^next\/link$|\.module\.css$/ }, ({ path }) => ({
          path,
          namespace: 'mock-display',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'mock-display' }, ({ path }) => ({
          resolveDir: web,
          loader: 'jsx',
          contents:
            path === 'next/link'
              ? 'import React from "react"; export default function Link({ children, ...props }) { return <a {...props}>{children}</a>; }'
              : 'export default new Proxy({}, { get: (_, key) => String(key) });',
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
await page.setContent(
  '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'"><main id="root"></main>',
);
await page.addScriptTag({ content: bundle.outputFiles[0].text });
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
async function click(label) {
  for (const button of await page.$$('button')) {
    if ((await button.evaluate((el) => el.textContent.trim())) === label) {
      await button.click();
      return;
    }
  }
  throw new Error('Button not found: ' + label);
}
async function guide(behavior = {}, hydrated = true) {
  await mount('guide', behavior);
  if (hydrated) await text('Guide review progress saved.');
  await page.click('input[type="checkbox"]');
  await click('Step by step');
}
async function typeCode(value) {
  await page.click('input[role="combobox"]');
  await page.$eval('input[role="combobox"]', (el) => el.select());
  await page.keyboard.type(value);
}
let passed = 0;
async function test(name, run) {
  await run();
  passed++;
  console.log('PASS ' + name);
}
try {
  await test('unmatched code survives blur; old code/title clear until explicit custom selection', async () => {
    await mount('picker');
    await typeCode('6A70.X9');
    await text('No match in this catalogue.');
    await page.click('#outside');
    assert.equal(await page.$eval('input', (el) => el.value), '6A70.X9');
    assert.equal(await page.$eval('#code', (el) => el.textContent), '');
    assert.equal(await page.$eval('#label', (el) => el.textContent), '');
    await click('Use this code: 6A70.X9');
    assert.equal(await page.$eval('#code', (el) => el.textContent), '6A70.X9');
    await text('Confirm its accuracy and enter the diagnosis label.');
    assert.equal(await page.evaluate(() => window.submits), 0);
  });
  await test('keyboard confirms custom codes and catalogue results without submitting form', async () => {
    await mount('picker');
    await typeCode('6A70.X9');
    await page.keyboard.press('Enter');
    assert.equal(await page.$eval('#code', (el) => el.textContent), '6A70.X9');
    await typeCode('6B00');
    const activeId = await page.$eval('input', (el) => el.getAttribute('aria-activedescendant'));
    assert.equal(
      await page.evaluate((id) => document.getElementById(id)?.getAttribute('role'), activeId),
      'option',
    );
    await page.keyboard.press('Enter');
    assert.equal(await page.$eval('#code', (el) => el.textContent), '6B00');
    assert.ok((await page.$eval('#label', (el) => el.textContent)).length > 0);
    assert.equal(await page.evaluate(() => window.submits), 0);
  });
  await test('reading during hydration preserves local section and restores only saved markers', async () => {
    await guide({ deferGet: true }, false);
    await click('Next section');
    await click('Next section');
    await text('Section 3 of 4');
    assert.equal(
      await page.evaluate(() => window.calls.filter((call) => call.method === 'PATCH').length),
      0,
    );
    await page.evaluate(() => window.releaseGet());
    await text('Guide review progress saved.');
    await text('Section 3 of 4');
    assert.deepEqual(await page.evaluate(() => window.saved.reviewedIndexes), [0]);
    assert.equal(await page.evaluate(() => window.saved.activeIndex), 2);
  });
  await test('slow marker save leaves reading free and coalesces later navigation checkpoints', async () => {
    await guide({ deferPatch: true });
    await click('Mark section reviewed');
    await page.waitForFunction(() => !!window.releasePatch);
    await text('1 of 4 guide sections reviewed');
    await click('Next section');
    await click('Next section');
    await text('Section 4 of 4');
    assert.equal(
      await page.evaluate(() => window.calls.filter((call) => call.method === 'PATCH').length),
      1,
    );
    await page.evaluate(() => {
      window.behavior = {};
      window.releasePatch();
    });
    await text('Guide review progress saved.');
    assert.deepEqual(await page.evaluate(() => window.saved.reviewedIndexes), [0, 1]);
    assert.equal(await page.evaluate(() => window.saved.activeIndex), 3);
    assert.deepEqual(
      await page.evaluate(() =>
        window.calls
          .filter((call) => call.method === 'PATCH')
          .map((call) => call.body.expectedRevision),
      ),
      [2, 3],
    );
  });
  for (const loseResponse of [false, true]) {
    await test(
      (loseResponse ? 'lost response' : 'offline save') +
        ' retains reading and retries the latest checkpoint safely',
      async () => {
        await guide(loseResponse ? { loseResponse: true } : { failPatch: true });
        await click('Mark section reviewed');
        await text('The last save could not be confirmed.');
        await text('1 of 4 guide sections reviewed');
        await click('Next section');
        await text('Section 3 of 4');
        await page.evaluate(() => {
          window.behavior = {};
        });
        await click('Retry save');
        await text('Guide review progress saved.');
        assert.deepEqual(await page.evaluate(() => window.saved.reviewedIndexes), [0, 1]);
        assert.equal(await page.evaluate(() => window.saved.activeIndex), 2);
      },
    );
  }
  await test('retry never overwrites changed markers from another view', async () => {
    await guide({ failPatch: true });
    await click('Mark section reviewed');
    await text('The last save could not be confirmed.');
    await page.evaluate(() => {
      window.behavior = {};
      window.saved = { ...window.saved, revision: 3, reviewedIndexes: [0, 2] };
    });
    await click('Retry save');
    await text('Saved progress changed in another view.');
    await click('Next section');
    await text('Section 3 of 4');
    assert.deepEqual(await page.evaluate(() => window.saved.reviewedIndexes), [0, 2]);
    assert.equal(
      await page.evaluate(() => window.calls.filter((call) => call.method === 'PATCH').length),
      1,
    );
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  console.log(passed + ' isolated ICD and guide browser regressions passed.');
} finally {
  await browser.close();
}
