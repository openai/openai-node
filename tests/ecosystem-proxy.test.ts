import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { compiledFixture } from './utils/compiled-fixtures';

test.each(['upstream-error', 'downstream-error', 'downstream-close', 'relay'])(
  'ecosystem proxy handles %s without terminating the runner',
  (scenario) => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'openai-ecosystem-proxy-'));
    const marker = path.join(fixture, 'result');
    const preload = path.join(fixture, 'proxy-fixture.cjs');
    const waiter = path.join(fixture, 'wait.cjs');
    const bin = path.join(fixture, 'bin');
    try {
      mkdirSync(bin);
      mkdirSync(path.join(fixture, 'ecosystem-tests', 'node-ts-cjs'), { recursive: true });
      writeFileSync(path.join(fixture, 'package.json'), '{}');
      writeFileSync(
        waiter,
        `const fs = require('node:fs');
const timer = setInterval(() => {
  if (fs.existsSync(${JSON.stringify(marker)})) { clearInterval(timer); process.exit(0); }
}, 10);
setTimeout(() => process.exit(2), 5000);
`,
      );
      writeFileSync(
        path.join(bin, process.platform === 'win32' ? 'npm.cmd' : 'npm'),
        process.platform === 'win32'
          ? `@"${process.execPath}" "${waiter}"\r\n`
          : `#!/bin/sh\nexec '${process.execPath}' '${waiter}'\n`,
        { mode: 0o755 },
      );
      // Exercise the actual CLI and loopback CONNECT handler. Only its upstream
      // connection is replaced, so the fixture never contacts the OpenAI API.
      writeFileSync(
        preload,
        `const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const connect = net.connect;
const createServer = http.createServer;
const scenario = ${JSON.stringify(scenario)};
let upstreamSocket;
let client;
const echo = net.createServer(socket => socket.pipe(socket));
if (scenario === 'relay') echo.listen(0, '127.0.0.1');
net.connect = (port, host, callback) => {
  assert.equal(host, 'api.openai.com');
  assert.equal(port, 443);
  upstreamSocket = scenario === 'relay'
    ? connect(echo.address().port, '127.0.0.1', callback)
    : new net.Socket();
  if (scenario === 'upstream-error') {
    process.nextTick(() => upstreamSocket.destroy(new Error('synthetic upstream failure')));
  }
  return upstreamSocket;
};
http.createServer = (...args) => {
  const server = createServer(...args);
  server.on('connect', (_request, socket) => {
    if (scenario === 'downstream-error') {
      setImmediate(() => socket.destroy(new Error('synthetic downstream failure')));
    } else if (scenario === 'downstream-close') {
      setImmediate(() => socket.destroy());
    }
  });
  server.on('listening', () => {
    client = connect(server.address().port, '127.0.0.1', () => {
      client.write('CONNECT api.openai.com:443 HTTP/1.1\\r\\nHost: api.openai.com\\r\\n\\r\\n');
    });
    let received = '';
    let sent = false;
    client.on('data', data => {
      received += data;
      if (!sent && received.includes('\\r\\n\\r\\n')) {
        assert.match(received, /200 Connection Established/);
        sent = true;
        client.write('synthetic relay payload');
      }
      if (received.includes('synthetic relay payload')) client.end();
    });
    client.on('error', error => { if (error.code !== 'ECONNRESET') throw error; });
    client.on('close', () => {
      setImmediate(() => {
        assert.equal(upstreamSocket.destroyed, true);
        if (scenario === 'relay') assert.match(received, /synthetic relay payload/);
        echo.close();
        fs.writeFileSync(${JSON.stringify(marker)}, 'completed');
      });
    });
  });
  return server;
};
`,
      );
      const result = spawnSync(
        process.execPath,
        [
          '--require',
          preload,
          compiledFixture('ecosystem-tests/cli.ts'),
          'node-ts-cjs',
          '--fromNpm=openai',
          '--skipPack',
          '--noCleanup',
        ],
        {
          cwd: fixture,
          encoding: 'utf-8',
          timeout: 10_000,
          env: {
            ...process.env,
            OPENAI_API_KEY: undefined,
            PATH: `${bin}${path.delimiter}${process.env['PATH']}`,
          },
        },
      );
      expect(result.error, result.stderr).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      expect(readFileSync(marker, 'utf-8')).toBe('completed');
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  },
);
