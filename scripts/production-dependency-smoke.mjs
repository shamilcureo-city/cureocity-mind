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
    if (existsSync(manifest)) {
      const version = JSON.parse(readFileSync(manifest, 'utf8')).version;
      if (version) return version;
    }
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
const sockets = new Map();
const server = createServer((request, response) => {
  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    captures.push({
      url: request.url,
      method: request.method,
      contentType: request.headers['content-type'] ?? '',
      body: Buffer.concat(chunks).toString('utf8'),
      connection: request.headers.connection,
      socketId: sockets.get(request.socket),
    });

    // Valid JSON over an incomplete HTTP message must still fail: otherwise a
    // workaround for the old false positive could silently accept real loss.
    if (request.url.startsWith('/truncated/')) {
      const framing = request.url.endsWith('/missing-terminator')
        ? 'b\r\n{"ok":true}\r\n'
        : '64\r\n{"ok":true}';
      request.socket.end(
        `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: keep-alive\r\nTransfer-Encoding: chunked\r\n\r\n${framing}`,
        () => request.socket.destroy(),
      );
      return;
    }

    // Deliberately no Content-Length or Connection: close. This exercises the
    // Node 22.23.0 regression fixed in 22.23.1 (nodejs/node#64004), not a framing
    // workaround: https://nodejs.org/en/blog/release/v22.23.1.
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"ok":true}');
  });
});
server.on('connection', (socket) => {
  sockets.set(socket, sockets.size + 1);
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

  function assertChunkedKeepAlive(headers) {
    assert.equal(headers['transfer-encoding'], 'chunked');
    assert.equal(headers['content-length'], undefined);
    assert.equal(headers.connection, 'keep-alive');
  }

  function teeny(options) {
    return new Promise((resolve, reject) => {
      teenyRequest({ timeout: 5_000, ...options }, (error, response, body) => {
        if (error) reject(error);
        else resolve({ response, body });
      });
    });
  }

  // Repeat both request types through both actual storage dependencies. The
  // server-side socket check proves that the default agent reuses its socket.
  for (let round = 0; round < 2; round += 1) {
    for (const multipart of [false, true]) {
      const response = await gaxios.request({
        url: `${baseUrl}/gaxios-${multipart ? 'multipart' : 'request'}`,
        method: 'POST',
        ...(multipart
          ? {
              multipart: [
                { headers: { 'Content-Type': 'application/json' }, content: '{"meta":true}' },
                { headers: { 'Content-Type': 'text/plain' }, content: 'gaxios-payload' },
              ],
            }
          : { data: { smoke: true } }),
        responseType: 'json',
        timeout: 5_000,
        retry: false,
      });
      assert.deepEqual(response.data, { ok: true });
      assertChunkedKeepAlive(response.headers);
    }
    for (const multipart of [false, true]) {
      const { response, body } = await teeny({
        uri: `${baseUrl}/teeny-${multipart ? 'multipart' : 'request'}`,
        method: 'POST',
        headers: {},
        ...(multipart
          ? {
              multipart: [
                { 'Content-Type': 'application/json', body: '{"meta":true}' },
                { 'Content-Type': 'text/plain', body: Readable.from(['teeny-payload']) },
              ],
            }
          : { json: { smoke: true } }),
      });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(body, { ok: true });
      assertChunkedKeepAlive(response.headers);
    }
  }

  assert.equal(captures.length, 8);
  assert.equal(new Set(captures.map(({ socketId }) => socketId)).size, 1);
  for (const capture of captures) {
    assert.equal(typeof capture.socketId, 'number');
    assert.equal(capture.method, 'POST');
    assert.equal(capture.connection, 'keep-alive');
    if (capture.url.endsWith('-multipart')) {
      assert.match(capture.contentType, /^multipart\/related; boundary=/);
      assert.match(capture.body, /"meta":true/);
      assert(
        capture.body.includes(
          capture.url.startsWith('/gaxios') ? 'gaxios-payload' : 'teeny-payload',
        ),
      );
    } else {
      assert.match(capture.contentType, /^application\/json/);
      assert.match(capture.body, /"smoke":true/);
    }
  }

  const rejectedTruncations = [];
  for (const client of ['gaxios', 'teeny']) {
    for (const framing of ['missing-terminator', 'partial-chunk']) {
      const url = `${baseUrl}/truncated/${client}/${framing}`;
      await assert.rejects(
        client === 'gaxios'
          ? gaxios.request({ url, responseType: 'json', timeout: 5_000, retry: false })
          : teeny({ uri: url }),
        (error) => {
          // A timeout or JSON parse error is not proof of transport rejection.
          assert(['ERR_STREAM_PREMATURE_CLOSE', 'ECONNRESET'].includes(error.code), error.message);
          rejectedTruncations.push(`${client}:${framing}`);
          return true;
        },
      );
    }
  }
  assert.equal(captures.length, 12);

  console.log(
    JSON.stringify({
      node: process.version,
      firebaseAdmin: packageVersion(webRequire.resolve('firebase-admin')),
      storage: packageVersion(adminRequire.resolve('@google-cloud/storage')),
      gaxios: packageVersion(storageRequire.resolve('gaxios')),
      teenyRequest: packageVersion(storageRequire.resolve('teeny-request')),
      gaxiosUuid,
      teenyUuid,
      requests: captures.length,
      chunkedKeepAliveResponses: 8,
      reusedConnection: true,
      rejectedTruncations,
      status: 'ok',
    }),
  );
} finally {
  await deleteApp(firebaseApp);
  // Close only this fixture's sockets, including idle keep-alive connections.
  for (const socket of sockets.keys()) socket.destroy();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
