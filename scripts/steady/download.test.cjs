'use strict';

const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { once } = require('node:events');
const fs = require('node:fs');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const { finished } = require('node:stream/promises');

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'steady download test '));
const helper = path.join(__dirname, 'download');
const certificate = path.join(temporary, 'certificate.pem');
const key = path.join(temporary, 'key.pem');
// ZIP containing executable deno and deno.exe shell fixtures: #!/bin/sh\nexit 0\n.
const archive = Buffer.from(
  'UEsDBBQAAAAAAAAAIVDihkXDEQAAABEAAAAEAAAAZGVubyMhL2Jpbi9zaApleGl0IDAKUEsDBBQAAAAAAAAAIVDihkXDEQAAABEAAAAIAAAAZGVuby5leGUjIS9iaW4vc2gKZXhpdCAwClBLAQIUAxQAAAAAAAAAIVDihkXDEQAAABEAAAAEAAAAAAAAAAAAAADtgQAAAABkZW5vUEsBAhQDFAAAAAAAAAAhUOKGRcMRAAAAEQAAAAgAAAAAAAAAAAAAAO2BMwAAAGRlbm8uZXhlUEsFBgAAAAACAAIAaAAAAGoAAAAAAA==',
  'base64',
);

function shellPath(file) {
  return file.replaceAll('\\', '/');
}

function prepare() {
  const config = path.join(temporary, 'openssl.cnf');
  fs.writeFileSync(
    config,
    '[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=extensions\n' +
      '[dn]\nCN=localhost\n[extensions]\nsubjectAltName=IP:127.0.0.1\n' +
      'basicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyEncipherment,keyCertSign\n',
  );
  const generated = spawnSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-config',
      config,
      '-keyout',
      key,
      '-out',
      certificate,
    ],
    { encoding: 'utf-8', timeout: 30_000 },
  );
  assert.equal(generated.status, 0, `Synthetic TLS certificate generation failed: ${generated.stderr}`);
  // Schannel curl ignores CURL_CA_BUNDLE; an explicit CA also covers Windows
  // shells whose PATH selects the native curl before Git's OpenSSL build.
  fs.writeFileSync(path.join(temporary, '.curlrc'), `cacert = ${JSON.stringify(shellPath(certificate))}\n`);
}

function fixture(name, port) {
  const scripts = path.join(temporary, name, 'scripts/steady');
  const cache = path.join(scripts, '.cache');
  fs.mkdirSync(scripts, { recursive: true });
  for (const file of ['settings', 'publish.cjs', 'source-sha256.cjs']) {
    fs.copyFileSync(path.join(__dirname, file), path.join(scripts, file));
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf-8'));
  // Empty synthetic source and a disposable runtime keep the real installer offline.
  manifest.steady.sha256 = createHash('sha256').update('[]').digest('hex');
  for (const target of Object.keys(manifest.deno.sha256)) {
    manifest.deno.sha256[target] = createHash('sha256').update(archive).digest('hex');
  }
  fs.writeFileSync(path.join(scripts, 'manifest.json'), JSON.stringify(manifest));
  fs.mkdirSync(path.join(cache, `source-${manifest.steady.revision}`), { recursive: true });
  const installer = fs.readFileSync(path.join(__dirname, 'install'), 'utf-8');
  const downloadLine =
    /^ {4}"https:\/\/github\.com\/denoland\/deno\/releases\/download\/v\$DENO_VERSION\/deno-\$DENO_TARGET\.zip" \\$/mu;
  assert.match(installer, downloadLine);
  fs.writeFileSync(
    path.join(scripts, 'install'),
    installer.replace(downloadLine, `    "https://127.0.0.1:${port}/archive.zip" \\`),
  );
  // Scale only timers needed by the regression; preserve curl and TLS options.
  let source = fs.readFileSync(helper, 'utf-8');
  if (name === 'stall') {
    source = source.replace(/--speed-time\s+\d+/u, '--speed-time 1');
  } else if (name === 'progress') {
    source = source
      .replace(/--retry-max-time\s+\d+/u, '--retry-max-time 1')
      .replace(/--max-time\s+[\d.]+/u, '--max-time 1');
  }
  fs.writeFileSync(path.join(scripts, 'download'), source, { mode: 0o755 });
  return { scripts, cache };
}

async function exercise(name, respond, options = {}) {
  let requests = 0;
  let connections = 0;
  const sockets = new Set();
  const server = https.createServer(
    { key: fs.readFileSync(key), cert: fs.readFileSync(certificate) },
    (_request, response) => {
      requests += 1;
      respond(response, requests);
    },
  );
  server.on('connection', (socket) => {
    connections += 1;
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    if (options.resetAlways || (options.resetFirst && connections === 1)) {
      socket.destroy();
    }
  });
  let child;
  try {
    const listening = once(server, 'listening');
    server.listen(0, '127.0.0.1');
    await listening;
    const { scripts, cache } = fixture(name, server.address().port);
    child = spawn('bash', [shellPath(path.join(scripts, 'install'))], {
      env: {
        ...process.env,
        STEADY_CACHE_LEASE: '1',
        CURL_HOME: shellPath(temporary),
        CURL_CA_BUNDLE: shellPath(certificate),
        NO_PROXY: '127.0.0.1',
        no_proxy: '127.0.0.1',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
      timeout: 30_000,
      killSignal: 'SIGKILL',
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    // On timeout, clean up the server even if curl still holds the stderr pipe.
    const [status, signal] = await once(child, 'exit');
    assert.equal(signal, null, `${name} exceeded its test timeout: ${stderr}`);
    await finished(child.stderr);
    if (options.status === 'nonzero') {
      assert.notEqual(status, 0, `${name}: ${stderr}`);
    } else {
      assert.equal(status, options.status ?? 0, `${name}: ${stderr}`);
    }
    assert.equal(requests, options.requests ?? 2, `${name}: unexpected HTTP attempt count`);
    if (options.connections) {
      assert.equal(connections, options.connections, `${name}: unexpected connection count`);
    }
    if (options.error) {
      assert.match(stderr, options.error, name);
    }
    const entries = fs.readdirSync(cache);
    assert.equal(
      entries.some((entry) => entry.startsWith('install.')),
      false,
      `${name}: clean staging`,
    );
    const runtimes = entries.filter((entry) => entry.startsWith('deno-'));
    if (status === 0) {
      assert.equal(runtimes.length, 1, `${name}: publish exactly one verified runtime`);
      assert.deepEqual(fs.readFileSync(path.join(cache, runtimes[0], 'deno.zip')), archive, name);
    } else {
      assert.deepEqual(runtimes, [], `${name}: failed downloads must not publish a runtime`);
    }
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
    const closed = once(server, 'close');
    server.close();
    for (const socket of sockets) {
      socket.destroy();
    }
    await closed;
  }
}

async function main() {
  prepare();
  const chunkSize = Math.ceil(archive.length / 12);
  const cases = await Promise.allSettled([
    exercise('tls-reset', (response) => response.end(archive), {
      resetFirst: true,
      requests: 1,
      connections: 2,
    }),
    exercise(
      'truncated',
      (response, attempt) => {
        response.writeHead(200, { 'Content-Length': archive.length, Connection: 'close' });
        response.end(attempt === 1 ? archive.subarray(0, 64) : archive);
      },
      { error: /curl: \(18\)/u },
    ),
    exercise('permanent-tls-reset', (response) => response.end(archive), {
      resetAlways: true,
      requests: 0,
      connections: 4,
      status: 'nonzero',
    }),
    exercise(
      'permanent-failure',
      (response) => {
        response.writeHead(404);
        response.end();
      },
      { status: 22, requests: 4 },
    ),
    exercise('checksum-mismatch', (response) => response.end('synthetic corrupt archive'), {
      status: 1,
      requests: 1,
      error: /Deno download checksum mismatch/u,
    }),
    exercise(
      'insecure-redirect',
      (response) => {
        response.writeHead(302, { Location: 'http://127.0.0.1:1/archive.zip' });
        response.end();
      },
      { status: 1, requests: 4 },
    ),
    exercise(
      'stall',
      (response, attempt) => {
        if (attempt === 1) {
          response.writeHead(200, { 'Content-Length': archive.length });
          response.flushHeaders();
        } else {
          response.end(archive);
        }
      },
      { error: /curl: \(28\)/u },
    ),
    exercise(
      'progress',
      (response) => {
        response.writeHead(200, { 'Content-Length': archive.length });
        let sent = 0;
        // Three seconds of steady progress must outlive the scaled one-second
        // retry window and the old absolute transfer deadline, if reintroduced.
        const timer = setInterval(() => {
          response.write(archive.subarray(sent * chunkSize, (sent + 1) * chunkSize));
          sent += 1;
          if (sent === 12) {
            clearInterval(timer);
            response.end();
          }
        }, 250);
        response.once('close', () => clearInterval(timer));
      },
      { requests: 1 },
    ),
  ]);
  const failures = cases.filter((result) => result.status === 'rejected').map((result) => result.reason);
  if (failures.length > 0) {
    throw new AggregateError(failures, 'Steady download regressions failed');
  }
  console.log(
    'Steady download: retries, HTTPS redirects, stalls, slow progress, checksum verification, publication, and cleanup passed.',
  );
}

async function runMain() {
  try {
    await main();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
void runMain();
