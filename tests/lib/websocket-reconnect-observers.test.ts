import { spawnSync } from 'node:child_process';
import { compiledFixture } from '../utils/compiled-fixtures';

// Recovery reports callback failures from a background task. Test their
// existing Node error propagation in a child so Vitest does not absorb it.
const observeRecovery = `
const { WebSocketServer } = require('ws');
const OpenAI = require(process.argv[1]).default;
const { [process.argv[3]]: Socket } = require(process.argv[2]);
const role = process.argv[4];
const mode = process.argv[5];
const rejected = [];
const received = [];
const seen = [];
const reported = [];
const successFailure = new Error('synthetic success listener failure');
const reportingFailure = { marker: 'synthetic error listener failure' };
const staged = JSON.stringify({ type: 'synthetic.user_event', event_id: 'never_attempted' });

process.on('unhandledRejection', (error) => {
  rejected.push(error === (mode === 'reconnected throws' ? successFailure : reportingFailure));
});

(async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise((resolve) => server.once('listening', resolve));
  let connections = 0;
  let first;
  server.on('connection', (peer) => {
    connections++;
    first ??= peer;
    peer.on('message', (data) => received.push(String(data)));
  });
  const client = new OpenAI({
    apiKey: 'synthetic-fixture',
    baseURL: 'http://127.0.0.1:' + server.address().port + '/v1',
  });
  let connection;
  const options = {
    reconnect: {
      onReconnecting: () => {
        connection.sendRaw(staged);
        return {};
      },
      maxRetries: 1,
      initialDelay: 1,
      maxDelay: 1,
    },
  };
  connection = role
    ? new Socket(client, { session_id: 'synthetic-session' }, options)
    : new Socket(client, options);
  connection.on('error', (error) => {
    reported.push(error.message);
    if (mode === 'both throw' || mode === 'close also throws') throw reportingFailure;
  });
  connection.on('reconnecting', () => {
    if (mode !== 'reconnected throws') throw Error('synthetic reconnecting listener failure');
  });
  connection.on('reconnected', () => {
    if (mode === 'reconnected throws') throw successFailure;
  });
  if (mode === 'close also throws') {
    connection.on('close', () => { throw Error('synthetic later close listener failure'); });
  }
  const iterator = connection.stream();
  async function next() {
    let timer;
    const item = await Promise.race([
      iterator.next(),
      new Promise((resolve) => { timer = setTimeout(() => resolve({ timedOut: true }), 2500); }),
    ]);
    clearTimeout(timer);
    seen.push(item.timedOut ? 'timeout' : item.done ? 'done' : item.value.type);
    return item;
  }
  try {
    await next();
    if (seen.at(-1) === 'connecting') await next();
    if (!first || seen.at(-1) !== 'open') throw Error('initial connection did not open: ' + seen);
    first.close(1012, 'synthetic service restart');
    let terminal;
    for (let i = 0; i < 5; i++) {
      const item = await next();
      if (item.timedOut || item.done || ['close', 'reconnected'].includes(item.value.type)) {
        terminal = item.value;
        break;
      }
    }
    let rejectedLateSend = false;
    if (terminal?.type === 'close') {
      try {
        connection.sendRaw(JSON.stringify({ type: 'synthetic.user_event', event_id: 'after_close' }));
      } catch (error) {
        rejectedLateSend = error === reportingFailure;
      }
      await next();
    }
    // Let the local peer process the accepted frame and Node report kept errors.
    await new Promise((resolve) => setTimeout(resolve, 40));
    process.stdout.write(JSON.stringify({
      connections, seen, reported, rejected, received, staged, rejectedLateSend,
      unsent: terminal?.type === 'close' ? terminal.unsent : undefined,
      socketState: connection.socket.readyState,
    }));
  } finally {
    await iterator.return();
    connection.close();
    for (const peer of server.clients) peer.terminate();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
`;

describe.each([
  ['Live', 'src/resources/live/ws.ts', 'LiveWS', ''],
  ['Live forks', 'src/resources/live/forks/ws.ts', 'ForksWS', 'forks'],
  ['Live sideband', 'src/resources/live/sideband/ws.ts', 'SidebandWS', 'sideband'],
  ['Responses', 'src/resources/responses/ws.ts', 'ResponsesWS', ''],
  ['Beta Responses', 'src/resources/beta/responses/ws.ts', 'ResponsesWS', ''],
] as const)('%s reconnect observer failures', (_name, module, className, role) => {
  test.each(['reconnected throws', 'reconnecting throws', 'both throw', 'close also throws'] as const)(
    '%s keeps the iterator and admission state consistent',
    (mode) => {
      const result = spawnSync(
        process.execPath,
        [
          '-e',
          observeRecovery,
          compiledFixture('src/index.ts'),
          compiledFixture(module),
          className,
          role,
          mode,
        ],
        { encoding: 'utf-8', timeout: 12_000 },
      );
      expect(result.error).toBeUndefined();
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      const state = JSON.parse(result.stdout);
      if (mode === 'both throw' || mode === 'close also throws') {
        expect(state).toMatchObject({
          connections: 1,
          seen: ['connecting', 'open', 'error', 'close', 'done'],
          reported: ['onReconnecting callback threw', 'cannot send on a closed WebSocket'],
          rejected: [true],
          rejectedLateSend: true,
          received: [],
          unsent: [{ type: 'raw', data: state.staged }],
          socketState: 3,
        });
      } else {
        expect(state).toMatchObject({
          connections: 2,
          seen:
            mode === 'reconnected throws'
              ? ['connecting', 'open', 'reconnecting', 'reconnected']
              : ['connecting', 'open', 'error', 'reconnecting', 'reconnected'],
          reported: mode === 'reconnected throws' ? [] : ['onReconnecting callback threw'],
          rejected: mode === 'reconnected throws' ? [true] : [],
          received: [state.staged],
          socketState: 1,
        });
      }
    },
  );
});
