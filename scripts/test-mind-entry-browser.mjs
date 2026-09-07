/**
 * Isolated real-React browser regressions. No running app, database, or network.
 * Uses the repository's existing Puppeteer and esbuild dependencies; no install.
 * Run: node scripts/test-mind-entry-browser.mjs
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
assert.ok(existsSync(executablePath), `Test Chromium is not installed: ${executablePath}`);

const bundle = await build({
  stdin: {
    resolveDir: web,
    loader: 'tsx',
    contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { ScheduleSessionPanel } from './components/app/ScheduleSessionPanel';
      import { ClientsHeader } from './components/app/ClientsHeader';
      import { PreparePanel } from './components/app/PreparePanel';
      import { MindTherapyGuide } from './components/app/MindTherapyGuide';
      import { NoteEditor } from './components/app/NoteEditor';
      import { TranscriptTab } from './components/app/TranscriptTab';
      import { MindSessionAgreements } from './components/app/MindSessionAgreements';
      import { MindCloseoutDecisionActions } from './components/app/MindCloseoutDecisionActions';
      import { NoteRecoveryNotice } from './components/app/NoteRecoveryNotice';
      import { NoteEditingLayout } from './components/app/NoteEditingLayout';
      const root = createRoot(document.getElementById('root'));
      const clients = [
        { id: 'client-a', fullName: 'Asha Example', preferredModality: null },
        { id: 'client-b', fullName: 'Beena Example', preferredModality: null },
      ];
      let mount = 0;
      window.calls = [];
      window.routes = [];
      window.behavior = {};
      window.prepareSignals = [];
      window.refreshCount = 0;
      window.agreements = [];
      function NoticeCase() {
        const [status, setStatus] = React.useState('loading');
        return <><NoteRecoveryNotice sessionId="synthetic-session" draftUpdatedAt="2026-09-07T10:00:00.000Z"
          onStatusChange={setStatus} onResume={() => window.routes.push('edit')} />
          <button id="fake-sign" disabled={status !== 'none'}>Fictional sign gate</button></>;
      }
      const guideVersion = '2026-09-06T10:00:00.000Z';
      const realTimeoutSignal = AbortSignal.timeout.bind(AbortSignal);
      AbortSignal.timeout = milliseconds => realTimeoutSignal(window.behavior.shortGuideDeadline || window.behavior.shortDeadline ? 25 : milliseconds);
      const script = { version: 'V1', therapyName: 'Synthetic guide', openingScript: 'Synthetic opening', mainExercise: { steps: [{ id: 'one', purpose: 'Synthetic exercise', therapistSays: 'Synthetic prompt', listenFor: 'Synthetic context', branches: [] }] }, closingScript: 'Synthetic close', homework: { description: 'Synthetic next step', deliveryNotes: 'If agreed' }, adaptationCues: [], riskWatchpoints: [], estimatedDurationMin: 20 };
      window.guideSaved = null;
      const syntheticNote = {
        version: 'V1', modality: 'CBT', subjective: 'Original client account', objective: 'Original observations', assessment: 'Original clinical understanding', plan: 'Original plan',
        summary: 'Old generated summary', topics: [{ title: 'Old generated topic', points: ['Old generated point'] }], templateSections: [{ title: 'Old generated template', body: 'Old generated wording' }],
        linkedEvidence: [{ quote: 'Old synthetic evidence' }], phaseHints: [{ phase: 'old-phase', confidence: 0.5 }], riskFlags: { severity: 'low', indicators: ['retain-safety-flag'] }, modalitySpecific: { syntheticObservation: 'retain-clinical-observation' },
      };
      window.fetch = async (url, options = {}) => {
        const body = options.body ? JSON.parse(options.body) : null;
        window.calls.push({ url: String(url), method: options.method ?? 'GET', body });
        if (String(url).endsWith('/agreements')) {
          if (window.behavior.agreementHangs) return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), {once: true}));
          if (window.behavior.agreementFail) return new Response(JSON.stringify({error:'Synthetic agreement save failed'}), {status:503});
          if (options.method === 'POST') window.agreements.push({id:'agreement-' + window.agreements.length, text:body.text});
          return new Response(JSON.stringify(options.method === 'POST' ? {agreement:window.agreements.at(-1)} : {agreements:window.agreements}), {status:200});
        }
        if (String(url).endsWith('/note-edit-recovery')) return new Response(JSON.stringify({revision:0, recovery:window.behavior.hasRecovery ? {fields:{}} : null, stale:false}), {status:window.behavior.recoveryFail ? 503 : 200});
        if (String(url).endsWith('/note-draft')) {
          return new Response(JSON.stringify({ status: 'COMPLETED', transcript: 'Synthetic saved transcript from completed processing.', speakerSegments: null, totalCostInr: '0', errorMessage: null }), { status: 200 });
        }
        if (String(url).includes('/therapy-scripts/') && String(url).endsWith('/review')) {
          if (options.method === 'PATCH') {
            const commit = () => {
              if (body.expectedRevision !== (window.guideSaved?.revision ?? 0)) return new Response(JSON.stringify({ code: 'GUIDE_REVIEW_CONFLICT' }), { status: 409 });
              const { expectedRevision, ...snapshot } = body;
              window.guideSaved = { ...snapshot, revision: expectedRevision + 1 };
              return new Response(JSON.stringify({ progress: window.guideSaved }), { status: 200 });
            };
            if (window.behavior.guideWriteDeferred) {
              window.oldGuideSignal = options.signal;
              return new Promise((resolve, reject) => {
                window.resolveGuideWrite = () => resolve(commit());
                if (window.behavior.rejectGuideAbort) options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
              });
            }
            return commit();
          }
          const read = () => new Response(JSON.stringify({ progress: window.guideSaved, revision: window.guideSaved?.revision ?? 0, scriptUpdatedAt: window.behavior.staleGuide ? '2026-09-07T10:00:00.000Z' : guideVersion }), { status: 200 });
          if (window.behavior.guideHydrationDeferred) return new Promise((resolve, reject) => {
            window.resolveGuideRead = () => resolve(read());
            if (window.behavior.rejectGuideAbort) options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
          });
          return read();
        }
        if (String(url).includes('/prepare')) {
          window.prepareSignals.push(options.signal);
          if (window.behavior.prepareDeferred) return new Promise(resolve => { window.resolvePrepare = resolve; });
          return new Response(JSON.stringify({ error: 'Preparation temporarily unavailable' }), { status: 503 });
        }
        if (String(url).includes('/mind-closeout')) {
          if (window.behavior.skipReject) throw new TypeError('Mock connection unavailable');
          return new Response(JSON.stringify(window.behavior.skipFail ? { error: 'Mock follow-up save failed' } : { ok: true }), { status: window.behavior.skipFail ? 503 : 200 });
        }
        if (url === '/api/v1/clients') {
          return new Response(JSON.stringify({ id: 'created-example', fullName: body.fullName, preferredModality: null }), { status: 201 });
        }
        if (url === '/api/v1/sessions') {
          if (window.behavior.bookingFail) return new Response(JSON.stringify({ error: 'Mock booking failed' }), { status: 503 });
          const row = window.behavior.malformedReceipt ? {} : {
            id: window.behavior.reused ? 'saved-existing' : 'saved-' + window.calls.length,
            clientId: body.clientId,
            scheduledAt: window.behavior.reused ? '2099-10-12T04:30:00.000Z' : body.scheduledAt,
          };
          return new Response(JSON.stringify(row), { status: window.behavior.reused ? 200 : 201 });
        }
        throw new Error('Unexpected mocked request: ' + url);
      };
      window.mountCase = (kind, behavior = {}) => {
        window.calls = []; window.routes = []; window.prepareSignals = []; window.behavior = behavior;
        window.noteSaves = []; window.noteCancels = 0; window.linkClicks = []; window.confirmMessages = []; window.confirmAnswer = false;
        window.agreements = [];
        window.confirm = message => { window.confirmMessages.push(message); return window.confirmAnswer; };
        if (behavior.resetGuide) window.guideSaved = { version: 1, revision: 2, scriptUpdatedAt: guideVersion, activeIndex: 1, reviewedIndexes: [0] };
        const key = ++mount;
        root.render(<div key={key} data-case-key={key}>{kind === 'entry'
          ? <ClientsHeader key={key} initiallyOpen returnToSession captureMode="BATCH" />
          : kind === 'prepare'
          ? <PreparePanel key={key} clientId="client-a" defaultOpen />
          : kind === 'guide'
          ? <MindTherapyGuide key={key} script={script} reviewTarget={{ clientId: 'client-a', scriptId: 'guide-a', scriptUpdatedAt: guideVersion }} />
          : kind === 'editor'
          ? <section key={key}><NoteEditor note={syntheticNote} saving={false} onSave={next => window.noteSaves.push(next)} onCancel={() => window.noteCancels++} />
              <a id="leave-note" href="https://example.test/app/today" onClick={event => { event.preventDefault(); window.linkClicks.push('leave'); }}>Leave note</a>
              <a id="within-note" href="#note-section" onClick={event => { event.preventDefault(); window.linkClicks.push('within'); }}>Within note</a>
            </section>
          : kind === 'transcript'
          ? <TranscriptTab key={key} sessionId="synthetic-session" data={{ status: 'IN_PROGRESS', transcript: null, segments: null, totalCostInr: '0', backend: null, errorMessage: null }} />
          : kind === 'agreements'
          ? <><MindSessionAgreements sessionId="synthetic-session" signed={false} />
              <a id="leave-agreement" href="https://example.test/app/today" onClick={event => { event.preventDefault(); window.linkClicks.push('leave'); }}>Leave agreement</a></>
          : kind === 'finish'
          ? <MindCloseoutDecisionActions sessionId="synthetic-session" canShare={false} canReviewClinical={!behavior.noClinical}
              steps={{clinicalSuggestions:'PENDING', agreements:'PENDING', nextSessionQuestions:'PENDING', shared:'PENDING'}}
              clinicalReview={<label>Fictional clinical review<input id="inline-review" /></label>} />
          : kind === 'notice' ? <NoticeCase />
          : kind === 'editing-layout'
          ? <NoteEditingLayout reference={<p>Fictional transcript reference</p>}><label>Fictional editable note<input id="layout-note" /></label></NoteEditingLayout>
          : <ScheduleSessionPanel key={key} clients={clients}
              initialClientId={kind === 'closeout' ? 'client-a' : undefined}
              initialDate="2099-10-05" initialTime="10:00"
              closeoutMode={kind === 'closeout'}
              sourceSessionId={kind === 'closeout' ? 'source-example' : undefined}
            />}</div>);
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
      name: 'isolated-next-runtime',
      setup(builder) {
        builder.onResolve({ filter: /^next\/(link|navigation)$/ }, ({ path }) => ({
          path,
          namespace: 'test-runtime',
        }));
        builder.onResolve({ filter: /^\.\/UpgradeModal$/ }, () => ({
          path: 'upgrade',
          namespace: 'test-runtime',
        }));
        builder.onResolve({ filter: /\.module\.css$/ }, () => ({
          path: 'styles',
          namespace: 'test-runtime',
        }));
        builder.onResolve({ filter: /^\.\/SessionDirection$/ }, ({ importer }) =>
          importer.endsWith('PreparePanel.tsx')
            ? { path: 'direction', namespace: 'test-runtime' }
            : undefined,
        );
        builder.onLoad({ filter: /.*/, namespace: 'test-runtime' }, ({ path }) => ({
          resolveDir: web,
          loader: 'jsx',
          contents:
            path === 'next/link'
              ? `import React from 'react'; export default function Link({children, ...props}) { return <a {...props}>{children}</a>; }`
              : path === 'next/navigation'
                ? `export const useRouter = () => ({ push: url => window.routes.push(url), replace: url => window.routes.push(url), refresh: () => window.refreshCount++ });`
                : path === 'upgrade'
                  ? `export function UpgradeModal() { return null; }`
                  : path === 'styles'
                    ? `export default new Proxy({}, { get: (_, key) => String(key) });`
                    : `export function DiagnosisChips() { return null; } export function QuestionsChecklist() { return null; }`,
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
const browserErrors = [];
const blockedRequests = [];
page.on('pageerror', (error) => browserErrors.push(error.message));
await page.setRequestInterception(true);
page.on('request', (request) => {
  // Native date/time controls load embedded data-URL icons, not network resources.
  if (request.url().startsWith('data:')) {
    void request.continue();
    return;
  }
  blockedRequests.push(request.url());
  void request.abort();
});
await page.setContent(
  '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'"><main id="root"></main>',
);
await page.addScriptTag({ content: bundle.outputFiles[0].text });

async function clickButton(label) {
  const buttons = await page.$$('button');
  for (const button of buttons) {
    if ((await button.evaluate((node) => node.textContent.trim())) === label) {
      await button.click();
      return;
    }
  }
  throw new Error(`Button not found: ${label}`);
}
async function mount(kind, behavior = {}) {
  const key = await page.evaluate(
    (kind, behavior) => window.mountCase(kind, behavior),
    kind,
    behavior,
  );
  await page.waitForSelector(`[data-case-key="${key}"]`);
  await page.waitForFunction(
    (kind) =>
      kind === 'entry'
        ? !!document.querySelector('#cc-name')
        : ['agreements', 'finish', 'notice', 'editing-layout'].includes(kind)
          ? !!document.querySelector('[data-case-key]')
          : kind === 'editor'
            ? !!document.querySelector('textarea')
            : kind === 'transcript'
              ? document.body.textContent.includes('Transcript not ready yet')
              : kind === 'guide'
                ? document.body.textContent.includes('Synthetic guide')
                : kind === 'prepare'
                  ? document.body.textContent.includes('Preparation temporarily unavailable')
                  : [...document.querySelectorAll('button')].some(
                      (button) =>
                        button.textContent.trim() ===
                        (kind === 'closeout' ? 'Schedule next session' : 'Schedule session'),
                    ),
    {},
    kind,
  );
}
async function waitForText(text) {
  await page.waitForFunction(
    (text) => document.getElementById('root')?.innerText.includes(text),
    { polling: 100 },
    text,
  );
}
async function calls() {
  return page.evaluate(() => window.calls);
}
async function assertGuideReviewBlocked() {
  assert.equal(
    await page.evaluate(
      () =>
        [...document.querySelectorAll('button')].find(
          (button) =>
            button.textContent.includes('Mark section reviewed') ||
            button.textContent.includes('Reviewed · undo'),
        )?.disabled,
    ),
    true,
  );
}
async function replaceClinicalField(field, text) {
  const selector = `textarea[id$="-${field}"]`;
  await page.focus(selector);
  await page.$eval(selector, (element) => element.select());
  await page.keyboard.press('Backspace');
  if (text) await page.type(selector, text);
}
let passed = 0;
async function test(name, run) {
  await run();
  passed++;
  console.log(`PASS ${name}`);
}

try {
  await test('A → search B clears hidden selection; only explicitly selected B is submitted', async () => {
    await mount('general');
    await clickButton('Schedule session');
    await page.waitForSelector('#sched-search');
    await page.select('select[aria-label="Pick a client"]', 'client-a');
    await page.type('#sched-search', 'Beena');
    assert.equal(
      await page.$eval('select[aria-label="Pick a client"]', (element) => element.value),
      '',
    );
    assert.equal(await page.$eval('button[type="submit"]', (element) => element.disabled), true);
    assert.equal((await calls()).length, 0);
    await page.select('select[aria-label="Pick a client"]', 'client-b');
    const displayed = await page.$eval(
      'select[aria-label="Pick a client"]',
      (element) => element.selectedOptions[0].textContent,
    );
    assert.match(displayed, /Beena Example/);
    await clickButton('Schedule');
    await waitForText('Booked for');
    assert.equal((await calls())[0].body.clientId, 'client-b');
  });

  await test('Today can schedule another appointment without a page reload', async () => {
    await clickButton('Schedule another session');
    await page.waitForSelector('#sched-search');
    await page.select('select[aria-label="Pick a client"]', 'client-a');
    await clickButton('Schedule');
    await waitForText('Booked for');
    assert.deepEqual(
      (await calls()).map((call) => call.body.clientId),
      ['client-b', 'client-a'],
    );
  });

  await test('schedule dialog traps keyboard focus and Escape returns it to the trigger', async () => {
    await mount('general');
    await clickButton('Schedule session');
    await page.waitForSelector('#sched-search');
    await page.select('select[aria-label="Pick a client"]', 'client-a');
    await page.focus('button[type="submit"]');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), 'cancel');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
    assert.equal(
      await page.evaluate(() => document.activeElement.textContent.trim()),
      'Schedule session',
    );
    assert.equal((await calls()).length, 0);
  });

  await test('closeout fixes identity to A and displays reused server booking, not submitted date', async () => {
    await mount('closeout', { reused: true });
    await clickButton('Schedule next session');
    await waitForText('Follow-up for');
    assert.equal(await page.$('#sched-search'), null);
    assert.equal(await page.$('select[aria-label="Pick a client"]'), null);
    assert.match(await page.$eval('form', (element) => element.textContent), /Asha Example/);
    await clickButton('Schedule');
    await waitForText('Booked for');
    const request = (await calls())[0];
    assert.equal(request.body.clientId, 'client-a');
    assert.equal(request.body.sourceSessionId, 'source-example');
    assert.match(request.body.scheduledAt, /^2099-10-05/);
    const receipt = await page.$eval('[role="status"]', (element) => element.textContent);
    assert.match(receipt, /12 Oct/);
    assert.equal(
      await page.$eval('a', (element) => element.getAttribute('href')),
      '/app/sessions/saved-existing',
    );
    const button = await page.$('button');
    assert.equal(await button.evaluate((element) => element.disabled), true);
  });

  await test('failed skip stays open and shows both HTTP and network failures', async () => {
    await mount('closeout', { skipFail: true });
    await clickButton('Schedule next session');
    await clickButton('Skip follow-up');
    await waitForText('Mock follow-up save failed');
    assert.ok(await page.$('[role="dialog"]'));
    await page.evaluate(() => {
      window.behavior = { skipReject: true };
    });
    await clickButton('Skip follow-up');
    await waitForText('Mock connection unavailable');
    assert.ok(await page.$('[role="dialog"]'));
    await page.evaluate(() => {
      window.behavior = {};
    });
    await clickButton('Skip follow-up');
    await waitForText('Follow-up intentionally skipped');
  });

  await test('booking failures do not falsely complete the session or dismiss the dialog', async () => {
    await mount('general', { bookingFail: true });
    await clickButton('Schedule session');
    await page.select('select[aria-label="Pick a client"]', 'client-a');
    await clickButton('Schedule');
    await waitForText('Mock booking failed');
    assert.ok(await page.$('[role="dialog"]'));
    assert.equal(await page.$('[role="status"]'), null);
  });

  await test('saved but unreadable booking receipt warns before another booking', async () => {
    await mount('general', { malformedReceipt: true });
    await clickButton('Schedule session');
    await page.select('select[aria-label="Pick a client"]', 'client-a');
    await clickButton('Schedule');
    await waitForText('confirmation could not be read');
    assert.equal((await calls()).length, 1);
  });

  await test('new walk-in entry opens form and returns to BATCH session setup', async () => {
    await mount('entry');
    await page.type('#cc-name', 'Synthetic New Client');
    const submit = await page.$('button[type="submit"]');
    assert.equal(await submit.evaluate((button) => button.disabled), false);
    await submit.click();
    await page.waitForFunction(() => window.routes.length === 1);
    assert.deepEqual(await page.evaluate(() => window.routes), [
      '/app/encounters/new?record=created-example&capture=BATCH',
    ]);
    const request = (await calls())[0];
    assert.equal(request.url, '/api/v1/clients');
    assert.equal(request.body.fullName, 'Synthetic New Client');
    assert.equal(
      (await calls()).some((call) => call.url === '/api/v1/sessions'),
      false,
    );
  });

  await test('Prepare failure makes one request and retries only on explicit action', async () => {
    await mount('prepare');
    // Deliberate observation window catches the former loading-effect retry loop.
    await new Promise((resolve) => setTimeout(resolve, 350));
    assert.equal((await calls()).length, 1);
    await clickButton('Retry preparation');
    await waitForText('Preparation temporarily unavailable');
    assert.equal((await calls()).length, 2);
  });

  await test('leaving Prepare aborts its pending request before another workspace renders', async () => {
    await page.evaluate(() => window.mountCase('prepare', { prepareDeferred: true }));
    await page.waitForFunction(() => window.prepareSignals.length === 1);
    await page.evaluate(() => {
      window.previousPrepareSignal = window.prepareSignals[0];
    });
    await mount('general');
    assert.equal(await page.evaluate(() => window.previousPrepareSignal.aborted), true);
    await page.evaluate(() =>
      window.resolvePrepare(
        new Response(JSON.stringify({ error: 'Old preparation' }), { status: 503 }),
      ),
    );
    assert.equal(
      await page.evaluate(() => document.body.textContent.includes('Old preparation')),
      false,
    );
  });

  await test('guide hydration allows reading but blocks review markers, then uses latest acknowledged revisions', async () => {
    await mount('guide', { resetGuide: true, guideHydrationDeferred: true });
    await page.click('input[type="checkbox"]');
    await clickButton('Step by step');
    assert.equal(
      await page.$eval('nav[aria-label="Guide sections"] button', (button) => button.disabled),
      false,
    );
    await clickButton('Mark section reviewed');
    assert.equal((await calls()).filter((call) => call.method === 'PATCH').length, 0);
    await assertGuideReviewBlocked();
    await page.evaluate(() => window.resolveGuideRead());
    await waitForText('Guide review progress saved.');
    await clickButton('Mark section reviewed');
    await waitForText('Guide review progress saved.');
    assert.deepEqual(await page.evaluate(() => window.guideSaved.reviewedIndexes), [0, 1]);
    await clickButton('Next section');
    await page.waitForFunction(() => window.guideSaved.revision === 4);
    assert.deepEqual(
      (await calls())
        .filter((call) => call.method === 'PATCH')
        .map((call) => call.body.expectedRevision),
      [2, 3],
    );
    assert.equal(
      (await calls()).some((call) => call.body?.suitable || call.body?.therapyDelivered),
      false,
    );
  });

  await test('guide conflicts pause editing and require an explicit reload of server progress', async () => {
    await mount('guide', { resetGuide: true });
    await waitForText('Guide review progress saved.');
    await page.click('input[type="checkbox"]');
    await clickButton('Step by step');
    await page.evaluate(() => {
      window.guideSaved = { ...window.guideSaved, revision: 3, reviewedIndexes: [0, 2] };
    });
    await clickButton('Mark section reviewed');
    await waitForText('Saved progress changed in another view.');
    await assertGuideReviewBlocked();
    assert.deepEqual(await page.evaluate(() => window.guideSaved.reviewedIndexes), [0, 2]);
    assert.equal(
      await page.$eval('nav[aria-label="Guide sections"] button', (button) => button.disabled),
      false,
    );
    await clickButton('Reload saved progress');
    await waitForText('Guide review progress saved.');
    await clickButton('Mark section reviewed');
    await page.waitForFunction(() => window.guideSaved.revision === 4);
    assert.deepEqual(await page.evaluate(() => window.guideSaved.reviewedIndexes), [0, 1, 2]);
  });

  await test('late write from a closed guide cannot overwrite a reopened guide revision', async () => {
    await mount('guide', { resetGuide: true, guideWriteDeferred: true });
    await waitForText('Guide review progress saved.');
    await page.click('input[type="checkbox"]');
    await clickButton('Step by step');
    await clickButton('Mark section reviewed');
    await page.waitForFunction(() => !!window.resolveGuideWrite);
    await mount('general');
    assert.equal(await page.evaluate(() => window.oldGuideSignal.aborted), true);
    await mount('guide');
    await waitForText('Guide review progress saved.');
    await page.click('input[type="checkbox"]');
    await clickButton('Step by step');
    await clickButton('Next section');
    await page.waitForFunction(() => window.guideSaved.revision === 3);
    await page.evaluate(() => window.resolveGuideWrite());
    assert.equal(await page.evaluate(() => window.guideSaved.activeIndex), 2);
    assert.deepEqual(await page.evaluate(() => window.guideSaved.reviewedIndexes), [0]);
  });

  await test('changed guide content never restores or saves markers for an old draft', async () => {
    await mount('guide', { resetGuide: true, staleGuide: true });
    await waitForText('This draft has changed.');
    await page.click('input[type="checkbox"]');
    await clickButton('Step by step');
    assert.equal(
      await page.$eval('nav[aria-label="Guide sections"] button', (button) => button.disabled),
      false,
    );
    assert.equal((await calls()).filter((call) => call.method === 'PATCH').length, 0);
    await assertGuideReviewBlocked();
  });

  await test('guide GET and PATCH deadlines surface recoverable errors, not endless loading or saving', async () => {
    await mount('guide', {
      resetGuide: true,
      guideHydrationDeferred: true,
      rejectGuideAbort: true,
      shortGuideDeadline: true,
    });
    await waitForText('Saved progress could not be loaded.');
    assert.equal((await calls()).filter((call) => call.method === 'PATCH').length, 0);
    await page.evaluate(() => {
      window.behavior = {};
    });
    await clickButton('Reload saved progress');
    await waitForText('Guide review progress saved.');
    await page.click('input[type="checkbox"]');
    await clickButton('Step by step');
    await page.evaluate(() => {
      window.behavior = {
        guideWriteDeferred: true,
        rejectGuideAbort: true,
        shortGuideDeadline: true,
      };
    });
    await clickButton('Mark section reviewed');
    await waitForText('The last save could not be confirmed.');
    await assertGuideReviewBlocked();
    assert.equal(
      await page.$eval('nav[aria-label="Guide sections"] button', (button) => button.disabled),
      false,
    );
    await page.evaluate(() => {
      window.behavior = {};
    });
    await clickButton('Reload saved progress');
    await waitForText('Guide review progress saved.');
    assert.deepEqual(await page.evaluate(() => window.guideSaved.reviewedIndexes), [0]);
  });

  await test('actual note editor submits corrected canonical fields without stale generated projections or signing', async () => {
    await mount('editor');
    for (const field of ['subjective', 'objective', 'assessment', 'plan']) {
      await replaceClinicalField(field, `Corrected ${field}`);
    }
    await waitForText('Unsaved changes — save before leaving this note.');
    await clickButton('Save note');
    const saves = await page.evaluate(() => window.noteSaves);
    assert.equal(saves.length, 1);
    for (const field of ['subjective', 'objective', 'assessment', 'plan']) {
      assert.equal(saves[0][field], `Corrected ${field}`);
    }
    for (const stale of ['summary', 'topics', 'templateSections']) {
      assert.equal(Object.hasOwn(saves[0], stale), false);
    }
    assert.deepEqual(saves[0].linkedEvidence, []);
    assert.deepEqual(saves[0].phaseHints, []);
    assert.deepEqual(saves[0].riskFlags, { severity: 'low', indicators: ['retain-safety-flag'] });
    assert.deepEqual(saves[0].modalitySpecific, {
      syntheticObservation: 'retain-clinical-observation',
    });
    assert.deepEqual(await calls(), [], 'Editing does not start generation or signing');
  });

  await test('dirty note cancel retains text unless the clinician explicitly confirms discard', async () => {
    await mount('editor');
    await replaceClinicalField('subjective', 'Unsaved synthetic correction');
    await clickButton('Cancel');
    assert.equal(await page.evaluate(() => window.noteCancels), 0);
    assert.equal(
      await page.$eval('textarea[id$="-subjective"]', (element) => element.value),
      'Unsaved synthetic correction',
    );
    assert.deepEqual(await page.evaluate(() => window.confirmMessages), [
      'Discard your unsaved note changes?',
    ]);
    await page.evaluate(() => {
      window.confirmAnswer = true;
    });
    await clickButton('Cancel');
    assert.equal(await page.evaluate(() => window.noteCancels), 1);
    assert.deepEqual(await page.evaluate(() => window.noteSaves), []);
  });

  await test('dirty note captures cancelled leave links but permits in-document links without signing', async () => {
    await mount('editor');
    await replaceClinicalField('plan', 'Unsaved synthetic plan');
    await page.click('#leave-note');
    assert.deepEqual(await page.evaluate(() => window.linkClicks), []);
    assert.deepEqual(await page.evaluate(() => window.confirmMessages), [
      'Your note has unsaved changes. Leave without saving them?',
    ]);
    await page.click('#within-note');
    assert.deepEqual(await page.evaluate(() => window.linkClicks), ['within']);
    assert.equal(await page.evaluate(() => window.confirmMessages.length), 1);
    assert.equal(
      await page.$eval('textarea[id$="-plan"]', (element) => element.value),
      'Unsaved synthetic plan',
    );
    assert.deepEqual(await page.evaluate(() => window.noteSaves), []);
    assert.deepEqual(await calls(), []);
  });

  await test('empty required clinical fields block submission and keep entered corrections', async () => {
    await mount('editor');
    await replaceClinicalField('subjective', '   ');
    await replaceClinicalField('plan', 'Retained synthetic plan');
    await clickButton('Save note');
    await waitForText('Client account · Subjective cannot be empty.');
    assert.deepEqual(await page.evaluate(() => window.noteSaves), []);
    assert.equal(
      await page.$eval('textarea[id$="-plan"]', (element) => element.value),
      'Retained synthetic plan',
    );
  });

  await test('actual transcript tab polls processing and displays the completed saved transcript', async () => {
    await mount('transcript');
    await waitForText('This view will update automatically.');
    await waitForText('Synthetic saved transcript from completed processing.');
    await waitForText('Saved transcript');
    assert.equal(
      await page.evaluate(() => document.body.textContent.includes('Transcript not ready yet')),
      false,
    );
    assert.deepEqual(await calls(), [
      { url: '/api/v1/sessions/synthetic-session/note-draft', method: 'GET', body: null },
    ]);
    assert.equal(
      await page.$$eval('button', (buttons) => buttons.length),
      0,
      'Viewing the saved transcript has no generation/signing action',
    );
  });

  await test('unsaved agreements guard leaving and unload until the save is acknowledged', async () => {
    await mount('agreements');
    await page.waitForSelector('#closeout-agreement');
    await page.type('#closeout-agreement', 'Fictional agreed next step');
    await page.click('#leave-agreement');
    assert.deepEqual(await page.evaluate(() => window.linkClicks), []);
    assert.equal(
      await page.evaluate(() => {
        const event = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      }),
      true,
    );
    assert.equal(
      await page.$eval('#closeout-agreement', (el) => el.value),
      'Fictional agreed next step',
    );
    await clickButton('Save agreement');
    await page.waitForFunction(() => document.getElementById('closeout-agreement').value === '');
    assert.equal((await calls()).filter((call) => call.method === 'POST').length, 1);
    await page.click('#leave-agreement');
    assert.deepEqual(await page.evaluate(() => window.linkClicks), ['leave']);
    assert.equal(
      await page.evaluate(() => {
        const event = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      }),
      false,
    );
  });

  await test('an agreement timeout retains the text and permits an explicit retry', async () => {
    await mount('agreements');
    await page.waitForSelector('#closeout-agreement');
    await page.type('#closeout-agreement', 'Fictional retry agreement');
    await page.evaluate(() => {
      window.behavior = { agreementHangs: true, shortDeadline: true };
    });
    await clickButton('Save agreement');
    await waitForText('The save could not be confirmed. Your text is still here.');
    assert.equal(
      await page.$eval('#closeout-agreement', (el) => el.value),
      'Fictional retry agreement',
    );
    assert.equal(await page.$eval('#closeout-agreement', (el) => el.disabled), false);
    await page.evaluate(() => {
      window.behavior = {};
    });
    await clickButton('Save agreement');
    await page.waitForFunction(() => document.getElementById('closeout-agreement').value === '');
    assert.equal((await calls()).filter((call) => call.method === 'POST').length, 2);
  });

  await test('clinical closeout opens inline without accepting anything and preserves unfinished review', async () => {
    await mount('finish');
    await clickButton('Review suggestions here');
    await page.waitForSelector('#inline-review');
    assert.deepEqual(await calls(), []);
    assert.deepEqual(await page.evaluate(() => window.routes), []);
    await page.type('#inline-review', 'Fictional unfinished review');
    await clickButton('Return to finish checklist');
    assert.equal(await page.$eval('#inline-review', (el) => !!el.closest('[hidden]')), true);
    await clickButton('Choose questions here');
    assert.equal(
      await page.$eval('#inline-review', (el) => el.value),
      'Fictional unfinished review',
    );
    assert.deepEqual(await calls(), []);
    await clickButton('Reviewed');
    assert.deepEqual(
      (await calls()).map((call) => call.body),
      [{ step: 'clinicalSuggestions', outcome: 'COMPLETE' }],
    );
  });

  await test('documentation-only closeout hides clinical review controls without writing skipped decisions', async () => {
    await mount('finish', { noClinical: true });
    assert.equal(
      await page.evaluate(() =>
        document.getElementById('root').innerText.includes('Review suggestions here'),
      ),
      false,
    );
    assert.equal(
      await page.evaluate(() =>
        document.getElementById('root').innerText.includes('Choose questions here'),
      ),
      false,
    );
    assert.deepEqual(await calls(), []);
  });

  await test('a delayed panel heading focus never interrupts typing already in progress', async () => {
    await mount('finish');
    await page.evaluate(() => {
      window.originalReviewFrame = window.requestAnimationFrame;
      window.reviewFrames = [];
      window.requestAnimationFrame = (callback) => {
        window.reviewFrames.push(callback);
        return 1;
      };
    });
    try {
      await clickButton('Review suggestions here');
      await page.waitForSelector('#inline-review');
      await page.type('#inline-review', 'Fictional review');
      await page.evaluate(() =>
        window.reviewFrames.splice(0).forEach((callback) => callback(performance.now())),
      );
      assert.equal(await page.evaluate(() => document.activeElement.id), 'inline-review');
      await page.keyboard.type(' continued');
      assert.equal(
        await page.$eval('#inline-review', (el) => el.value),
        'Fictional review continued',
      );
      assert.deepEqual(await calls(), []);
    } finally {
      await page.evaluate(() => {
        window.requestAnimationFrame = window.originalReviewFrame;
      });
    }
  });

  await test('recovery notice reports available and failed checks to the sign gate; opening only resumes editing', async () => {
    await mount('notice', { hasRecovery: true });
    await waitForText('There are saved edits to review.');
    assert.equal(await page.$eval('#fake-sign', (el) => el.disabled), true);
    await clickButton('Resume saved edits');
    assert.deepEqual(await page.evaluate(() => window.routes), ['edit']);
    assert.equal(
      (await calls()).every((call) => call.method === 'GET'),
      true,
    );
    await mount('notice', { recoveryFail: true });
    await waitForText('Saved edits could not be checked.');
    assert.equal(await page.$eval('#fake-sign', (el) => el.disabled), true);
    await mount('notice');
    await page.waitForFunction(() => document.getElementById('fake-sign').disabled === false);
  });

  await test('showing and hiding the transcript reference keeps the active note edit mounted', async () => {
    await mount('editing-layout');
    await page.type('#layout-note', 'Fictional correction in progress');
    await clickButton('Show transcript reference');
    await waitForText('Fictional transcript reference');
    assert.equal(
      await page.$eval('#layout-note', (el) => el.value),
      'Fictional correction in progress',
    );
    await clickButton('Hide transcript reference');
    assert.equal(
      await page.$eval('#layout-note', (el) => el.value),
      'Fictional correction in progress',
    );
    assert.deepEqual(await calls(), []);
  });

  assert.deepEqual(browserErrors, [], 'Unexpected React/browser errors');
  assert.deepEqual(blockedRequests, [], 'Components attempted an unmocked network request');
  console.log(
    `${passed} isolated React browser regressions passed. No live app, database, or network used.`,
  );
} finally {
  await browser.close();
}
