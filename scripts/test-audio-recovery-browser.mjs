/**
 * Isolated real-Chromium WebCrypto/IndexedDB smoke test. Fictional bytes and
 * fixed fixture keys only; no app server, database, auth, provider, or microphone.
 * Uses existing Puppeteer/esbuild dependencies. No install or browser download.
 * Run: node scripts/test-audio-recovery-browser.mjs
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const web = join(root, 'apps/web');
const serviceRequire = createRequire(join(root, 'services/pdf-generator-service/package.json'));
const { build } = createRequire(serviceRequire.resolve('tsx/package.json'))('esbuild');
const puppeteer = serviceRequire('puppeteer');
const executablePath = await puppeteer.executablePath();
assert.ok(
  existsSync(executablePath),
  'Existing test Chromium is required; no download is attempted.',
);

const bundle = await build({
  stdin: {
    resolveDir: web,
    loader: 'ts',
    contents: `
      import { createSessionAudioStore } from './lib/audio/session-audio-store';
      import { createRecoveryContext } from './lib/live-recovery-draft';
      const databaseName = 'cureocity-mind-audio';
      const session = 'fictional-session-one';
      const account = 'fictional-account-one';
      const fixtureKey = btoa('f'.repeat(32));
      const chunk = (sessionId = session, chunkIndex = 7) => ({
        sessionId, chunkIndex, mimeType: 'audio/pcm', sampleRate: 16000,
        durationMs: 1000, bytes: new Uint8Array([1, 2, 3, 4, 5, 6]),
        enqueuedAt: 123, attempts: 0,
      });
      async function seedLegacy(holdOpen = false) {
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open(databaseName, 1);
          request.onupgradeneeded = () => {
            const chunks = request.result.createObjectStore('pending-chunks', { keyPath: ['sessionId', 'chunkIndex'] });
            chunks.createIndex('sessionId', 'sessionId', { unique: false });
            request.result.createObjectStore('sessions', { keyPath: 'sessionId' });
          };
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        await new Promise((resolve, reject) => {
          const transaction = db.transaction(['pending-chunks', 'sessions'], 'readwrite');
          transaction.objectStore('pending-chunks').put(chunk());
          transaction.objectStore('pending-chunks').put(chunk('fictional-other-session', 0));
          transaction.objectStore('sessions').put({ sessionId: session, nextChunkIndex: 0, startedAt: 100 });
          transaction.oncomplete = () => resolve();
          transaction.onabort = () => reject(transaction.error);
          transaction.onerror = () => reject(transaction.error);
        });
        if (holdOpen) window.legacyConnection = db;
        else db.close();
      }
      async function inspect(names, connection) {
        const db = connection ?? await new Promise((resolve, reject) => {
          const request = indexedDB.open(databaseName);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          return await new Promise((resolve, reject) => {
            const transaction = db.transaction(names, 'readonly');
            const requests = names.map(name => transaction.objectStore(name).getAll());
            transaction.oncomplete = () => resolve(Object.fromEntries(names.map((name, index) => [name, requests[index].result])));
            transaction.onabort = () => reject(transaction.error);
            transaction.onerror = () => reject(transaction.error);
          });
        } finally { if (!connection) db.close(); }
      }
      async function transplantToOtherAccount() {
        const values = await inspect(['pending-chunks-v2']);
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open(databaseName);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          await new Promise((resolve, reject) => {
            const transaction = db.transaction('pending-chunks-v2', 'readwrite');
            transaction.objectStore('pending-chunks-v2').put({
              ...values['pending-chunks-v2'][0], accountId: 'fictional-other-account',
            });
            transaction.oncomplete = () => resolve();
            transaction.onabort = () => reject(transaction.error);
            transaction.onerror = () => reject(transaction.error);
          });
        } finally { db.close(); }
      }
      async function makeStore(owner = account, id = session, key = fixtureKey) {
        return createSessionAudioStore(await createRecoveryContext(owner, id, key));
      }
      window.audioFixture = { session, account, fixtureKey, chunk, seedLegacy, inspect, makeStore, transplantToOtherAccount };
    `,
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
});

const errors = [];
const unexpectedRequests = [];
const server = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; script-src 'self'; connect-src 'none'; img-src data:",
  );
  if (request.url === '/fixture.js') {
    response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    response.end(bundle.outputFiles[0].text);
  } else if (request.url === '/') {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(
      '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><title>Fictional encrypted-audio fixture</title><script src="/fixture.js"></script>',
    );
  } else {
    response.writeHead(404).end();
  }
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const address = server.address();
assert.ok(address && typeof address === 'object');
const origin = `http://127.0.0.1:${address.port}`;
let browser;

try {
  browser = await puppeteer.launch({
    executablePath,
    headless: true,
    pipe: true,
    protocolTimeout: 20_000,
    args: [
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-sync',
      '--no-first-run',
    ],
  });
  const browserVersion = await browser.version();
  async function pageIn(context) {
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (
        [`${origin}/`, `${origin}/fixture.js`].includes(request.url()) ||
        request.url().startsWith('data:')
      ) {
        void request.continue();
      } else {
        unexpectedRequests.push(request.url());
        void request.abort();
      }
    });
    await page.goto(`${origin}/`, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean(window.audioFixture));
    return page;
  }

  // An isolated browser context is a fresh IndexedDB namespace, not a user's profile.
  const migrationContext = await browser.createBrowserContext();
  const page = await pageIn(migrationContext);
  assert.equal(await page.evaluate(() => window.isSecureContext), true);
  const migrated = await page.evaluate(async () => {
    const fixture = window.audioFixture;
    await fixture.seedLegacy();
    window.audioStore = await fixture.makeStore();
    const chunks = await window.audioStore.chunks.listForSession(fixture.session);
    const cursor = await window.audioStore.cursor.getCursor(fixture.session);
    const rows = await fixture.inspect([
      'pending-chunks',
      'sessions',
      'pending-chunks-v2',
      'sessions-v2',
    ]);
    return {
      bytes: Array.from(chunks[0].bytes),
      chunkCount: chunks.length,
      cursor,
      remainingRawSessions: rows['pending-chunks'].map((row) => row.sessionId),
      rawCursorCount: rows.sessions.length,
      encryptedCount: rows['pending-chunks-v2'].length,
      envelopeFields: Object.keys(rows['pending-chunks-v2'][0]).sort(),
      cursorFields: Object.keys(rows['sessions-v2'][0]).sort(),
      ciphertextIsString: typeof rows['pending-chunks-v2'][0].ciphertext === 'string',
    };
  });
  assert.deepEqual(migrated.bytes, [1, 2, 3, 4, 5, 6]);
  assert.equal(migrated.chunkCount, 1);
  assert.deepEqual(migrated.cursor, {
    sessionId: 'fictional-session-one',
    nextChunkIndex: 8,
    startedAt: 100,
  });
  assert.deepEqual(migrated.remainingRawSessions, ['fictional-other-session']);
  assert.equal(migrated.rawCursorCount, 0);
  assert.equal(migrated.encryptedCount, 1);
  const allowedEnvelopeFields = [
    'accountId',
    'chunkIndex',
    'ciphertext',
    'iv',
    'sessionId',
    'version',
  ];
  assert.deepEqual(migrated.envelopeFields, allowedEnvelopeFields);
  assert.deepEqual(migrated.cursorFields, allowedEnvelopeFields);
  assert.equal(migrated.ciphertextIsString, true);

  // A true navigation drops all context/key objects, leaving only browser IDB.
  await page.reload({ waitUntil: 'load' });
  const reopened = await page.evaluate(async () => {
    const fixture = window.audioFixture;
    window.audioStore = await fixture.makeStore();
    const chunks = await window.audioStore.chunks.listForSession(fixture.session);
    const other = await fixture.makeStore('fictional-other-account');
    const foreignCount = (await other.chunks.listForSession(fixture.session)).length;
    other.close();
    let foreignSessionRefused = false;
    try {
      await window.audioStore.chunks.listForSession('fictional-other-session');
    } catch {
      foreignSessionRefused = true;
    }
    const wrongKey = await fixture.makeStore(
      fixture.account,
      fixture.session,
      btoa('w'.repeat(32)),
    );
    let wrongKeyRefused = false;
    try {
      await wrongKey.chunks.listForSession(fixture.session);
    } catch {
      wrongKeyRefused = true;
    }
    wrongKey.close();
    await fixture.transplantToOtherAccount();
    const transplanted = await fixture.makeStore('fictional-other-account');
    let transplantRefused = false;
    try {
      await transplanted.chunks.listForSession(fixture.session);
    } catch {
      transplantRefused = true;
    }
    transplanted.close();
    return {
      bytes: Array.from(chunks[0].bytes),
      foreignCount,
      foreignSessionRefused,
      wrongKeyRefused,
      transplantRefused,
    };
  });
  assert.deepEqual(reopened, {
    bytes: [1, 2, 3, 4, 5, 6],
    foreignCount: 0,
    foreignSessionRefused: true,
    wrongKeyRefused: true,
    transplantRefused: true,
  });
  await migrationContext.close();

  // Real IDB upgrade blocking: another tab deliberately retains a v1 connection.
  const blockedContext = await browser.createBrowserContext();
  const oldPage = await pageIn(blockedContext);
  await oldPage.evaluate(() => window.audioFixture.seedLegacy(true));
  const newPage = await pageIn(blockedContext);
  const blockedMessage = await newPage.evaluate(async () => {
    window.blockedStore = await window.audioFixture.makeStore();
    try {
      await window.blockedStore.chunks.listForSession(window.audioFixture.session);
    } catch (error) {
      return error.message;
    }
    return 'Unexpected success';
  });
  assert.match(blockedMessage, /Close older recording tabs/);
  const retained = await oldPage.evaluate(async () => ({
    rows: (await window.audioFixture.inspect(['pending-chunks'], window.legacyConnection))[
      'pending-chunks'
    ].length,
    version: window.legacyConnection.version,
    encryptedStoreExists: window.legacyConnection.objectStoreNames.contains('pending-chunks-v2'),
  }));
  assert.deepEqual(retained, { rows: 2, version: 1, encryptedStoreExists: false });
  await newPage.evaluate(() => window.blockedStore.close());
  await oldPage.evaluate(() => {
    window.legacyConnection.close();
    window.legacyConnection = null;
  });
  const resumed = await newPage.evaluate(async () => {
    const fixture = window.audioFixture;
    const store = await fixture.makeStore();
    const chunks = await store.chunks.listForSession(fixture.session);
    const cursor = await store.cursor.getCursor(fixture.session);
    const rows = await fixture.inspect(['pending-chunks', 'pending-chunks-v2']);
    store.close();
    let closedRefused = false;
    try {
      await store.chunks.listForSession(fixture.session);
    } catch {
      closedRefused = true;
    }
    return {
      bytes: Array.from(chunks[0].bytes),
      nextChunkIndex: cursor.nextChunkIndex,
      rawSessions: rows['pending-chunks'].map((row) => row.sessionId),
      encryptedCount: rows['pending-chunks-v2'].length,
      closedRefused,
    };
  });
  assert.deepEqual(resumed, {
    bytes: [1, 2, 3, 4, 5, 6],
    nextChunkIndex: 8,
    rawSessions: ['fictional-other-session'],
    encryptedCount: 1,
    closedRefused: true,
  });
  await blockedContext.close();

  assert.deepEqual(errors, [], 'Browser page errors');
  assert.deepEqual(unexpectedRequests, [], 'Unexpected network requests');
  console.log(
    JSON.stringify(
      {
        status: 'passed',
        browser: browserVersion,
        checks: [
          'real-v1-to-v2-migration',
          'encrypted-payload-only',
          'cursor-high-water',
          'reload-recovery',
          'account-and-session-isolation',
          'wrong-key-and-AAD-refusal',
          'blocked-upgrade-preserves-raw',
          'recovery-after-old-tab-closes',
          'closed-context-refusal',
        ],
        boundary:
          'Isolated localhost fixture, fictional keys/audio; no real authentication, app, microphone, or production data.',
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
