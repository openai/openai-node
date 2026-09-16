'use strict';

const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { once } = require('node:events');
const fs = require('node:fs');
const https = require('node:https');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'steady download test '));
const scripts = path.join(temporary, 'scripts/steady');
const cache = path.join(scripts, '.cache');
const sockets = new Set();
let connections = 0;
let scenario;
let listener;

// ZIP containing executable deno and deno.exe shell fixtures: #!/bin/sh\nexit 0\n.
const archive = Buffer.from(
  'UEsDBBQAAAAAAAAAIVDihkXDEQAAABEAAAAEAAAAZGVubyMhL2Jpbi9zaApleGl0IDAKUEsDBBQAAAAAAAAAIVDihkXDEQAAABEAAAAIAAAAZGVuby5leGUjIS9iaW4vc2gKZXhpdCAwClBLAQIUAxQAAAAAAAAAIVDihkXDEQAAABEAAAAEAAAAAAAAAAAAAADtgQAAAABkZW5vUEsBAhQDFAAAAAAAAAAhUOKGRcMRAAAAEQAAAAgAAAAAAAAAAAAAAO2BMwAAAGRlbm8uZXhlUEsFBgAAAAACAAIAaAAAAGoAAAAAAA==',
  'base64',
);

async function check(name, expectedCode, expectedConnections, errorCode) {
  scenario = name;
  connections = 0;
  const child = spawn('bash', [path.join(scripts, 'install')], {
    env: {
      ...process.env,
      STEADY_CACHE_LEASE: '1',
      CURL_CA_BUNDLE: path.join(temporary, 'cert.pem'),
      NO_PROXY: '*',
      no_proxy: '*',
    },
    timeout: 30_000,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let errors = '';
  child.stderr.on('data', (data) => {
    errors += data;
  });
  const [code] = await once(child, 'close');
  assert.equal(code, expectedCode, `${name}: ${errors}`);
  assert.equal(connections, expectedConnections, `${name}: unexpected download attempts`);
  assert.match(errors, new RegExp(`curl: \\(${errorCode}\\)`, 'u'));
  const entries = fs.readdirSync(cache);
  assert.equal(
    entries.some((entry) => entry.startsWith('install.')),
    false,
    'Temporary files removed',
  );
  const runtimes = entries.filter((entry) => entry.startsWith('deno-'));
  if (expectedCode === 0) {
    assert.equal(runtimes.length, 1, 'Publish exactly one verified runtime');
    const runtime = path.join(cache, runtimes[0]);
    assert.deepEqual(fs.readFileSync(path.join(runtime, 'deno.zip')), archive);
    fs.rmSync(runtime, { recursive: true });
  } else {
    assert.deepEqual(runtimes, [], 'Failed downloads must not publish a runtime');
  }
  console.log(`Steady download: ${name} passed (${connections} attempts, exit ${code}).`);
}

async function main() {
  fs.mkdirSync(scripts, { recursive: true });
  for (const name of ['settings', 'publish.cjs', 'source-sha256.cjs']) {
    fs.copyFileSync(path.join(__dirname, name), path.join(scripts, name));
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf-8'));
  // Synthetic source and runtime make this an offline installer test.
  manifest.steady.sha256 = createHash('sha256').update('[]').digest('hex');
  for (const target of Object.keys(manifest.deno.sha256)) {
    manifest.deno.sha256[target] = createHash('sha256').update(archive).digest('hex');
  }
  fs.writeFileSync(path.join(scripts, 'manifest.json'), JSON.stringify(manifest));
  fs.mkdirSync(path.join(cache, `source-${manifest.steady.revision}`), { recursive: true });

  // Generate disposable credentials instead of checking a private key into the repository.
  const certificate = spawnSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=DNS:localhost',
      '-keyout',
      path.join(temporary, 'key.pem'),
      '-out',
      path.join(temporary, 'cert.pem'),
    ],
    { encoding: 'utf-8' },
  );
  assert.equal(certificate.status, 0, certificate.stderr);
  const server = https.createServer(
    {
      key: fs.readFileSync(path.join(temporary, 'key.pem')),
      cert: fs.readFileSync(path.join(temporary, 'cert.pem')),
    },
    (_request, response) => {
      response.writeHead(200, { 'Content-Length': archive.length, Connection: 'close' });
      // A complete HTTP exchange with a truncated body produces curl error 18.
      response.end(scenario === 'partial transfer' && connections === 1 ? archive.subarray(0, 64) : archive);
    },
  );
  listener = net.createServer((socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    connections += 1;
    if (scenario === 'permanent TLS reset' || (scenario === 'initial TLS reset' && connections === 1)) {
      socket.resetAndDestroy();
    } else {
      server.emit('connection', socket);
    }
  });
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  // Only redirect the fixture URL; execute the actual installer and unchanged curl options.
  const installer = fs.readFileSync(path.join(__dirname, 'install'), 'utf-8');
  assert.ok(installer.includes('https://github.com/denoland/deno/releases/download/'));
  fs.writeFileSync(
    path.join(scripts, 'install'),
    installer.replace('https://github.com', `https://localhost:${listener.address().port}`),
  );
  await check('initial TLS reset', 0, 2, 35);
  await check('partial transfer', 0, 2, 18);
  await check('permanent TLS reset', 35, 4, 35);
}

async function runMain() {
  try {
    await main();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    for (const socket of sockets) {
      socket.destroy();
    }
    if (listener?.listening) {
      listener.close();
      await once(listener, 'close');
    }
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
void runMain();
