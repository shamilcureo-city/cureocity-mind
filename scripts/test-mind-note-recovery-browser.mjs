/** Real Chromium note-recovery journeys with a fictional, intercepted server.
 * No running app, database, external network or real identity. Server state stays
 * in this process so reload/closed-tab tests really discard browser JS memory.
 * Run: node scripts/test-mind-note-recovery-browser.mjs
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
const origin = 'https://mind-recovery.example.test';
const baseVersion = '2026-09-07T10:00:00.000Z';
const original = {
  version: 'V1',
  modality: 'CBT',
  subjective: 'Fictional client account',
  objective: 'Fictional observations',
  assessment: 'Fictional assessment',
  plan: 'Fictional plan',
  linkedEvidence: [],
  phaseHints: [],
  riskFlags: { severity: 'none', indicators: [] },
  modalitySpecific: {},
};
const fieldsOf = (note) =>
  Object.fromEntries(
    ['subjective', 'objective', 'assessment', 'plan'].map((key) => [key, note[key]]),
  );
let canonical;
let recovery;
let revision;
let writes;
let applied;
let behavior;
let mutationReceipts;
let holdReads;
function reset() {
  canonical = { note: structuredClone(original), updatedAt: baseVersion };
  recovery = null;
  revision = 0;
  writes = [];
  applied = [];
  behavior = {};
  mutationReceipts = new Map();
  holdReads = [];
}
reset();

const bundle = await build({
  stdin: {
    resolveDir: web,
    loader: 'tsx',
    contents: `
    import React, { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import { NoteEditor } from './components/app/NoteEditor';
    function Demo() {
      const [done, setDone] = useState('');
      const [error, setError] = useState(null);
      const fixture = window.fixture;
      return done ? <p role="status">{done}</p> : <main>
        <h1>Fictional session note</h1>
        <NoteEditor note={fixture.note} saving={false} error={error}
          recoveryTarget={{ sessionId: 'fictional-session', kind: 'TREATMENT', baseUpdatedAt: fixture.updatedAt }}
          onCancel={() => setDone('Editor closed')}
          onSave={async (note, expectedRecoveryRevision) => {
            const response = await fetch('/api/v1/sessions/fictional-session/note-draft', { method: 'PUT',
              headers: {'content-type': 'application/json'}, body: JSON.stringify({ note, expectedUpdatedAt: fixture.updatedAt, expectedRecoveryRevision }) });
            if (!response.ok) { setError('Corrections could not be applied. Retry Apply corrections.'); return false; }
            setDone('Corrections applied'); return true;
          }} />
        <a id="leave" href="/away">Leave this note</a>
      </main>;
    }
    createRoot(document.getElementById('root')).render(<Demo />);
  `,
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"' },
  // Button shares a module with ButtonLink. This isolated component fixture has
  // no Next runtime; navigation itself uses real document links below.
  plugins: [
    {
      name: 'isolated-next-link',
      setup(builder) {
        builder.onResolve({ filter: /^next\/link$/ }, () => ({
          path: 'link',
          namespace: 'test-runtime',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'test-runtime' }, () => ({
          resolveDir: web,
          loader: 'jsx',
          contents: `import React from 'react'; export default function Link({children, ...props}) { return <a {...props}>{children}</a>; }`,
        }));
      },
    },
  ],
});
const html =
  () => `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'">
<style>:root{--color-ink:#232339;--color-ink-2:#54546c;--color-line:#ddddeb;--color-surface-soft:#f4f5fc}body{background:#f4f5fc;color:#232339;font:16px system-ui;margin:30px auto;max-width:760px}h1{font:30px Georgia}textarea{display:block;width:100%;box-sizing:border-box;padding:12px;margin:8px 0 20px;font:16px system-ui}button{padding:12px 18px;margin:6px}label{font-weight:600}p{line-height:1.5}main{background:white;padding:24px}</style>
<div id="root"></div><script>window.fixture=${JSON.stringify(canonical).replace(/</g, '\\u003c')};${bundle.outputFiles[0].text}</script>`;
const errors = [];
const blocked = [];
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
let page;
async function newPage() {
  const result = await browser.newPage();
  result.on('pageerror', (error) => errors.push(error.message));
  result.on('dialog', (dialog) => {
    void (behavior.dismissDialog ? dialog.dismiss() : dialog.accept());
  });
  await result.setRequestInterception(true);
  result.on('request', (request) => {
    const url = new URL(request.url());
    const respond = (status, body) =>
      request.respond({
        status,
        contentType: 'application/json',
        headers: { 'Cache-Control': 'no-store' },
        body: JSON.stringify(body),
      });
    if (url.origin !== origin) {
      blocked.push(url.origin);
      void request.abort();
      return;
    }
    if (url.pathname === '/note') {
      void request.respond({
        status: 200,
        contentType: 'text/html',
        headers: { 'Cache-Control': 'no-store' },
        body: html(),
      });
      return;
    }
    if (url.pathname === '/away') {
      void request.respond({
        status: 200,
        contentType: 'text/html',
        body: '<p>Away from the fictional note</p>',
      });
      return;
    }
    if (url.pathname.endsWith('/note-edit-recovery')) {
      if (request.method() === 'GET') {
        if (behavior.failRead) {
          void respond(503, { error: 'Synthetic lookup outage' });
          return;
        }
        const read = () =>
          respond(200, {
            revision,
            recovery,
            stale: !!recovery && recovery.baseUpdatedAt !== canonical.updatedAt,
          });
        if (behavior.holdRead) holdReads.push(read);
        else void read();
        return;
      }
      const body = JSON.parse(request.postData());
      writes.push({ method: request.method(), ...body });
      if (mutationReceipts.has(body.mutationId)) {
        void respond(200, mutationReceipts.get(body.mutationId));
        return;
      }
      if (body.revision !== revision) {
        void respond(409, { error: 'Recovery conflict' });
        return;
      }
      if (request.method() === 'DELETE') {
        recovery = null;
        revision++;
        const receipt = { revision };
        mutationReceipts.set(body.mutationId, receipt);
        if (behavior.loseDeleteAck) {
          behavior.loseDeleteAck = false;
          void request.abort('failed');
          return;
        }
        void respond(200, receipt);
        return;
      }
      if (body.baseUpdatedAt !== canonical.updatedAt) {
        void respond(409, { error: 'Canonical conflict' });
        return;
      }
      if (behavior.failWrite) {
        void respond(503, { error: 'Synthetic outage' });
        return;
      }
      recovery = {
        fields: body.fields,
        kind: body.kind,
        baseUpdatedAt: body.baseUpdatedAt,
        updatedAt: '2026-09-07T10:01:00.000Z',
      };
      revision++;
      const receipt = { revision, updatedAt: recovery.updatedAt };
      mutationReceipts.set(body.mutationId, receipt);
      if (behavior.loseAck) {
        behavior.loseAck = false;
        void request.abort('failed');
      } else void respond(200, receipt);
      return;
    }
    if (url.pathname.endsWith('/note-draft') && request.method() === 'PUT') {
      const body = JSON.parse(request.postData());
      if (behavior.failApply) {
        void respond(503, { error: 'Synthetic apply outage' });
        return;
      }
      if (
        body.expectedUpdatedAt !== canonical.updatedAt ||
        body.expectedRecoveryRevision !== revision
      ) {
        void respond(409, { error: 'Version changed' });
        return;
      }
      applied.push(body);
      canonical = { note: body.note, updatedAt: '2026-09-07T10:02:00.000Z' };
      recovery = null;
      revision++;
      void respond(200, canonical);
      return;
    }
    // Even same-origin unexpected requests cannot escape the fake server.
    void respond(404, { error: 'No fictional route' });
  });
  await result.goto(`${origin}/note`);
  return result;
}
async function waitText(text, targetPage = page) {
  await targetPage.waitForFunction(
    (value) => document.getElementById('root')?.innerText.includes(value),
    { polling: 100 },
    text,
  );
}
async function edit(field, text, targetPage = page) {
  await targetPage.bringToFront();
  await targetPage.waitForSelector(`textarea[id$="-${field}"]:not([disabled])`);
  await targetPage.$eval(
    `textarea[id$="-${field}"]`,
    (element, value) => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(
        element,
        value,
      );
      element.dispatchEvent(new Event('input', { bubbles: true }));
    },
    text,
  );
}
async function button(label, targetPage = page) {
  const candidates = await targetPage.$$('button');
  for (const item of candidates)
    if (await item.evaluate((element, text) => element.textContent.trim() === text, label)) {
      await item.click();
      return;
    }
  throw new Error(`Button missing: ${label}`);
}
async function value(field, targetPage = page) {
  return targetPage.$eval(`textarea[id$="-${field}"]`, (element) => element.value);
}
let count = 0;
async function test(name, body) {
  if (page && !page.isClosed()) await page.close();
  reset();
  page = await newPage();
  try {
    await body();
  } catch (error) {
    console.error(
      JSON.stringify({
        browserErrors: errors,
        text: await page.evaluate(() => document.getElementById('root')?.innerText.slice(0, 1800)),
        writes,
      }),
    );
    throw error;
  }
  count++;
  console.log(`PASS ${name}`);
}
try {
  await test('acknowledged edits survive a real document reload without applying the canonical note', async () => {
    await edit('subjective', 'Fictional correction that survives reload');
    await waitText('Draft edits saved securely.');
    assert.equal(canonical.note.subjective, original.subjective);
    await page.reload();
    await waitText('Your saved edits have been restored.');
    assert.equal(await value('subjective'), 'Fictional correction that survives reload');
    assert.equal(applied.length, 0);
    assert.deepEqual(
      await page.evaluate(() => [localStorage.length, sessionStorage.length]),
      [0, 0],
    );
  });
  await test('incomplete text survives tab close and new-tab restoration', async () => {
    await edit('assessment', '');
    await waitText('Draft edits saved securely.');
    await page.close();
    page = await newPage();
    await waitText('Your saved edits have been restored.');
    assert.equal(await value('assessment'), '');
    await button('Apply corrections');
    await waitText('cannot be empty.');
    assert.equal(
      await page.evaluate(() => document.activeElement.id.endsWith('-assessment')),
      true,
    );
    assert.equal(applied.length, 0);
  });
  await test('acknowledged recovery survives navigation and browser Back', async () => {
    await edit('plan', 'Fictional plan saved before navigation');
    await waitText('Draft edits saved securely.');
    await Promise.all([page.waitForNavigation(), page.click('#leave')]);
    await page.goBack();
    await page.waitForSelector('textarea[id$="-plan"]');
    assert.equal(await value('plan'), 'Fictional plan saved before navigation');
    assert.equal(canonical.note.plan, original.plan);
  });
  await test('lost response retry reuses its mutation and preserves later typing', async () => {
    behavior.loseAck = true;
    await edit('subjective', 'First fictional correction');
    await waitText('Recovery is not confirmed.');
    await edit('plan', 'Later fictional correction');
    await button('Retry saving edits');
    await waitText('Draft edits saved securely.');
    assert.equal(writes[1].mutationId, writes[0].mutationId);
    assert.equal(recovery.fields.plan, 'Later fictional correction');
    assert.equal(revision, 2);
  });
  await test('another tab cannot silently replace a newer recovery checkpoint', async () => {
    const second = await newPage();
    await second.waitForSelector('textarea:not([disabled])');
    await edit('subjective', 'First tab checkpoint');
    await waitText('Draft edits saved securely.');
    await edit('subjective', 'Second tab unsaved text', second);
    await waitText('changed in another view', second);
    assert.equal(await value('subjective', second), 'Second tab unsaved text');
    assert.equal(recovery.fields.subjective, 'First tab checkpoint');
    await button('Compare saved edits', second);
    await waitText('Compare the server copy below', second);
    assert.equal(await value('subjective', second), 'Second tab unsaved text');
    await second.click('details summary');
    await button('Use saved version', second);
    await waitText('Your saved edits have been restored.', second);
    assert.equal(await value('subjective', second), 'First tab checkpoint');
    await edit('plan', 'Merged by clinician after explicit comparison', second);
    await waitText('Draft edits saved securely.', second);
    assert.equal(recovery.fields.plan, 'Merged by clinician after explicit comparison');
    await second.close();
  });
  await test('stale recovery stays separate for comparison and explicit discard', async () => {
    await edit('plan', 'Old version fictional edits');
    await waitText('Draft edits saved securely.');
    canonical.updatedAt = '2026-09-07T11:00:00.000Z';
    canonical.note.plan = 'New canonical plan';
    await page.reload();
    await waitText('Saved edits belong to an older note.');
    assert.equal(await value('plan'), 'New canonical plan');
    assert.ok(await page.$('details'));
    await button('Discard edits');
    await waitText('Editor closed');
    assert.equal(recovery, null);
    assert.equal(canonical.note.plan, 'New canonical plan');
  });
  await test('Apply corrections carries the acknowledged recovery revision and applies only reviewed fields', async () => {
    await edit('subjective', 'Reviewed fictional correction');
    await button('Apply corrections');
    await waitText('Corrections applied');
    assert.equal(applied.length, 1);
    assert.equal(applied[0].expectedRecoveryRevision, 1);
    assert.equal(canonical.note.subjective, 'Reviewed fictional correction');
    assert.equal(recovery, null);
  });
  await test('failed canonical apply keeps the checkpoint and permits a safe retry', async () => {
    behavior.failApply = true;
    await edit('plan', 'Fictional plan retained after apply error');
    await button('Apply corrections');
    await waitText('Corrections could not be applied.');
    assert.equal(recovery.fields.plan, 'Fictional plan retained after apply error');
    behavior.failApply = false;
    await button('Apply corrections');
    await waitText('Corrections applied');
    assert.equal(applied.length, 1);
  });
  await test('failed autosave cannot be mistaken for an applied note', async () => {
    behavior.failWrite = true;
    await edit('plan', 'Fictional unsaved plan');
    await waitText('Recovery is not confirmed.');
    await button('Apply corrections');
    await waitText('Recovery is not confirmed.');
    assert.equal(applied.length, 0);
    assert.equal(canonical.note.plan, original.plan);
    behavior.failWrite = false;
    await button('Retry saving edits');
    await waitText('Draft edits saved securely.');
  });
  await test('closing the editor keeps acknowledged draft edits instead of deleting them', async () => {
    await edit('plan', 'Fictional edits to apply later');
    await waitText('Draft edits saved securely.');
    await button('Close editor');
    await waitText('Editor closed');
    assert.equal(recovery.fields.plan, 'Fictional edits to apply later');
    assert.equal(
      writes.some((write) => write.method === 'DELETE'),
      false,
    );
    await page.reload();
    await waitText('Your saved edits have been restored.');
    assert.equal(await value('plan'), 'Fictional edits to apply later');
  });
  await test('failed recovery lookup offers a safe close without modifying the server', async () => {
    behavior.failRead = true;
    await page.reload();
    await waitText('Recovery could not be checked.');
    assert.equal(await page.$eval('textarea', (el) => el.disabled), true);
    await button('Close editor');
    await waitText('Editor closed');
    assert.equal(writes.length, 0);
  });
  await test('lost discard acknowledgement retries the same deletion and closes only after confirmation', async () => {
    await edit('plan', 'Fictional draft to discard');
    await waitText('Draft edits saved securely.');
    behavior.loseDeleteAck = true;
    await button('Discard edits');
    await waitText('Retry discarding edits');
    assert.equal(recovery, null);
    assert.equal(await value('plan'), 'Fictional draft to discard');
    await button('Retry discarding edits');
    await waitText('Editor closed');
    const deletes = writes.filter((write) => write.method === 'DELETE');
    assert.equal(deletes.length, 2);
    assert.equal(deletes[0].mutationId, deletes[1].mutationId);
    assert.equal(canonical.note.plan, original.plan);
  });
  await test('Chromium same-document Back warns about unacknowledged corrections and respects staying', async () => {
    await page.evaluate(() => {
      history.pushState({}, '', '/note?view=first');
      history.pushState({}, '', '/note?view=second');
      window.guardConfirms = [];
      window.confirm = (message) => {
        window.guardConfirms.push(message);
        return false;
      };
    });
    behavior.failWrite = true;
    await edit('plan', 'Fictional unacknowledged correction before Back');
    await waitText('Recovery is not confirmed.');
    await page.evaluate(() => history.back());
    await page.waitForFunction(() => window.guardConfirms.length === 1);
    assert.equal(new URL(page.url()).search, '?view=second');
    assert.equal(await value('plan'), 'Fictional unacknowledged correction before Back');
    assert.equal(recovery, null);
    assert.equal(applied.length, 0);
  });
  assert.deepEqual(errors, [], 'No uncaught browser exceptions');
  assert.deepEqual(blocked, [], 'No unexpected external network attempted');
  console.log(
    `Note recovery browser journeys: ${count} passed. Fictional intercepted API only; no authenticated app/DB/device certification.`,
  );
} finally {
  await browser.close();
}
