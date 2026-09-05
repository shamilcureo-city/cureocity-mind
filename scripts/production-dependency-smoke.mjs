import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const webRequire = createRequire(join(root, 'apps/web/package.json'));
const adminRequire = createRequire(webRequire.resolve('firebase-admin'));
const storageRequire = createRequire(adminRequire.resolve('@google-cloud/storage'));

const { initializeApp, deleteApp } = webRequire('firebase-admin/app');
const { getAuth } = webRequire('firebase-admin/auth');
const { getStorage } = webRequire('firebase-admin/storage');
const { Gaxios } = storageRequire('gaxios');
const { teenyRequest } = storageRequire('teeny-request');

function packageVersion(entry) {
  let directory = dirname(entry);
  while (directory !== dirname(directory)) {
    const manifest = join(directory, 'package.json');
    if (existsSync(manifest)) return JSON.parse(readFileSync(manifest, 'utf8')).version;
    directory = dirname(directory);
  }
  throw new Error(`Could not locate package.json above ${entry}`);
}

function resolvedUuid(parentName) {
  const parentRequire = createRequire(storageRequire.resolve(parentName));
  const uuid = parentRequire('uuid');
  const version = parentRequire('uuid/package.json').version;
  assert.equal(version, '11.1.1', `${parentName} must resolve the audited uuid floor`);
  assert.match(uuid.v4(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  return version;
}

const captures = [];
const server = createServer((request, response) => {
  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    captures.push({
      url: request.url,
      method: request.method,
      contentType: request.headers['content-type'] ?? '',
      body: Buffer.concat(chunks).toString('utf8'),
    });
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"ok":true}');
  });
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});

const address = server.address();
assert(address && typeof address === 'object');
const baseUrl = `http://127.0.0.1:${address.port}`;
process.env.NO_PROXY = '127.0.0.1,localhost';
process.env.no_proxy = '127.0.0.1,localhost';

const firebaseApp = initializeApp(
  { projectId: 'dependency-smoke', storageBucket: 'dependency-smoke.example' },
  'production-dependency-smoke',
);

try {
  assert.equal(getAuth(firebaseApp).app.name, 'production-dependency-smoke');
  assert.equal(getStorage(firebaseApp).bucket().name, 'dependency-smoke.example');

  const gaxiosUuid = resolvedUuid('gaxios');
  const teenyUuid = resolvedUuid('teeny-request');
  const gaxios = new Gaxios();

  const regularResponse = await gaxios.request({
    url: `${baseUrl}/gaxios-request`,
    method: 'POST',
    data: { smoke: true },
    responseType: 'json',
  });
  assert.deepEqual(regularResponse.data, { ok: true });

  const multipartResponse = await gaxios.request({
    url: `${baseUrl}/gaxios-multipart`,
    method: 'POST',
    multipart: [
      { headers: { 'Content-Type': 'application/json' }, content: '{"meta":true}' },
      { headers: { 'Content-Type': 'text/plain' }, content: 'gaxios-payload' },
    ],
    responseType: 'json',
  });
  assert.deepEqual(multipartResponse.data, { ok: true });

  await new Promise((resolve, reject) => {
    teenyRequest(
      {
        uri: `${baseUrl}/teeny-multipart`,
        method: 'POST',
        headers: {},
        multipart: [
          { 'Content-Type': 'application/json', body: '{"meta":true}' },
          { 'Content-Type': 'text/plain', body: Readable.from(['teeny-payload']) },
        ],
      },
      (error, response, body) => {
        if (error) return reject(error);
        try {
          assert.equal(response.statusCode, 200);
          assert.deepEqual(body, { ok: true });
          resolve();
        } catch (assertionError) {
          reject(assertionError);
        }
      },
    );
  });

  assert.equal(captures.length, 3);
  assert.deepEqual(
    captures.map(({ url, method }) => ({ url, method })),
    [
      { url: '/gaxios-request', method: 'POST' },
      { url: '/gaxios-multipart', method: 'POST' },
      { url: '/teeny-multipart', method: 'POST' },
    ],
  );
  assert.match(captures[0].contentType, /^application\/json/);
  assert.match(captures[0].body, /"smoke":true/);
  assert.match(captures[1].contentType, /^multipart\/related; boundary=/);
  assert.match(captures[1].body, /gaxios-payload/);
  assert.match(captures[2].contentType, /^multipart\/related; boundary=/);
  assert.match(captures[2].body, /teeny-payload/);

  console.log(
    JSON.stringify({
      firebaseAdmin: packageVersion(webRequire.resolve('firebase-admin')),
      storage: packageVersion(adminRequire.resolve('@google-cloud/storage')),
      gaxios: packageVersion(storageRequire.resolve('gaxios')),
      teenyRequest: packageVersion(storageRequire.resolve('teeny-request')),
      gaxiosUuid,
      teenyUuid,
      requests: captures.length,
      status: 'ok',
    }),
  );
} finally {
  await deleteApp(firebaseApp);
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
