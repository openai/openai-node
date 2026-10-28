import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { compiledFixture, compiledFixtureConfig } from '../../utils/compiled-fixtures';

const quote = (part: string) => `'${part.split("'").join("'\\''")}'`;

async function runCLI(action: 'deadline' | 'signal' | 'terminal') {
  const server = createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/audio/speech') {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/octet-stream' });
    response.end(Buffer.alloc(1920));
  });
  const webSocket = new WebSocketServer({ server });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected local TCP address');
  }
  const arguments_ = [
    '-r',
    path.join(process.cwd(), 'node_modules/tsconfig-paths/register.js'),
    compiledFixture('examples/live/transcript-grouper.ts'),
    '--no-audio',
  ];
  const terminal = action === 'terminal';
  // script(1) supplies real terminal mode, so Node's readline processes Ctrl-C.
  const child = spawn(
    terminal ? '/usr/bin/script' : process.execPath,
    terminal
      ? ['-q', '-e', '-c', `exec ${[process.execPath, ...arguments_].map(quote).join(' ')}`, '/dev/null']
      : arguments_,
    {
      cwd: process.cwd(),
      env: {
        OPENAI_API_KEY: 'synthetic-live-cli-key',
        OPENAI_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
        TS_NODE_PROJECT: compiledFixtureConfig(),
        DISABLE_V8_COMPILE_CACHE: '1',
        NODE_COMPILE_CACHE: process.env['NODE_COMPILE_CACHE'],
        SystemRoot: process.env['SystemRoot'],
        SHELL: '/bin/sh',
      },
      stdio: [terminal ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      timeout: action === 'deadline' ? 65_000 : 12_000,
    },
  );
  if (!child.stdout || !child.stderr) {
    throw new Error('Expected CLI stdout and stderr pipes');
  }
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf-8').on('data', (data: string) => (stdout += data));
  child.stderr.setEncoding('utf-8').on('data', (data: string) => (stderr += data));
  let receivedStart = false;
  let receivedAudio = false;
  let receivedClose = false;
  let confirmedClose = false;
  let startedAt = 0;
  let closedAt = 0;
  webSocket.on('connection', (socket) => {
    socket.on('message', (data) => {
      // SAFETY: this local peer reads serialized messages from the actual SDK.
      const event = JSON.parse(data.toString()) as { type: string };
      if (event.type === 'session.start') {
        receivedStart = true;
        startedAt = performance.now();
        socket.send(
          JSON.stringify({ type: 'session.started', session: { id: 'fixture', status: 'active' } }),
        );
      } else if (event.type === 'session.input_audio.append' && !receivedAudio) {
        receivedAudio = true;
        if (action === 'deadline') {
          socket.send(
            JSON.stringify({
              type: 'session.input_transcript.delta',
              event_id: 'synthetic-input',
              delta: 'A vegetarian picnic.',
              start_ms: 0,
              end_ms: 40,
            }),
          );
        }
        if (action === 'signal') {
          child.kill('SIGINT');
        }
        if (terminal) {
          child.stdin?.write('\u0003');
        }
      } else if (event.type === 'session.close') {
        receivedClose = true;
        closedAt = performance.now();
        socket.send(JSON.stringify({ type: 'session.closed', reason: 'close_requested' }));
        confirmedClose = true;
      }
    });
  });
  try {
    const [exitCode, signal] = await once(child, 'close');
    expect(stdout + stderr).not.toContain('synthetic-live-cli-key');
    return {
      exitCode,
      signal,
      stdout,
      receivedStart,
      receivedAudio,
      receivedClose,
      confirmedClose,
      captureMs: closedAt - startedAt,
    };
  } finally {
    child.kill();
    for (const socket of webSocket.clients) {
      socket.terminate();
    }
    const wsClosed = once(webSocket, 'close');
    webSocket.close();
    await wsClosed;
    const httpClosed = once(server, 'close');
    server.close();
    await httpClosed;
  }
}

describe('Live transcript CLI capture and terminal input', () => {
  it.concurrent('captures to its default deadline with stdin redirected from /dev/null', async () => {
    const result = await runCLI('deadline');
    expect(result).toMatchObject({
      exitCode: 0,
      signal: null,
      receivedStart: true,
      receivedAudio: true,
      receivedClose: true,
      confirmedClose: true,
    });
    expect(result.captureMs).toBeGreaterThan(44_000);
    expect(result.stdout).toContain('A vegetarian picnic.');
    expect(result.stdout).toContain('final bubbles.');
  }, 70_000);

  // Windows subprocess.kill('SIGINT') terminates unconditionally, unlike a real console Ctrl-C.
  it.skipIf(process.platform === 'win32').concurrent(
    'cancels with exit 130 on process SIGINT during capture',
    async () => {
      const result = await runCLI('signal');
      expect(result).toMatchObject({ exitCode: 130, signal: null, receivedAudio: true });
      expect(result.stdout).not.toContain('final bubbles.');
    },
  );

  it.skipIf(process.platform !== 'linux').concurrent(
    'cancels readline Ctrl-C in an actual terminal',
    async () => {
      const result = await runCLI('terminal');
      expect(result).toMatchObject({ exitCode: 130, signal: null, receivedAudio: true });
      expect(result.stdout).not.toContain('final bubbles.');
    },
  );
});
