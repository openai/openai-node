import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { RealtimeServerEvent } from 'openai/resources/realtime/realtime';
import { expect, test } from 'vitest';
import { WebSocketServer } from 'ws';

import { createX509TestLab } from '../utils/x509-test-lab';

const guideSnippet = readFileSync('docs/realtime.md', 'utf-8').match(/```ts\r?\n(?<source>[\s\S]*?)\r?\n```/u)
  ?.groups?.['source'];
if (!guideSnippet?.includes("import { OpenAIRealtimeWS } from 'openai/realtime/ws';")) {
  throw new Error('Expected the basic ws example in the Realtime guide');
}
const inheritedCertificatePath = process.env['NODE_EXTRA_CA_CERTS'];
const inheritedCertificateAuthority = inheritedCertificatePath
  ? readFileSync(inheritedCertificatePath)
  : Buffer.alloc(0);

const cases = (['openai', 'azure'] as const).flatMap((provider) =>
  (provider === 'openai' ? (['ws', 'websocket', 'guide'] as const) : (['ws', 'websocket'] as const)).flatMap(
    (example) =>
      (['completed', 'failed', 'cancelled', 'incomplete', 'clean close', 'abrupt close'] as const).map(
        (scenario) => ({
          provider,
          example,
          scenario,
        }),
      ),
  ),
);

test.each(cases)('$provider Realtime $example handles $scenario', async ({ provider, example, scenario }) => {
  const lab = createX509TestLab();
  const directory = await mkdtemp(path.join(tmpdir(), 'openai-realtime-example-'));
  const certificatePath = path.join(directory, 'ca.pem');
  const identityPath = path.join(directory, 'azure-identity.cjs');
  const azureToken = 'synthetic-azure-example-token';
  const server = createServer({ cert: lab.server.certificate, key: lab.server.privateKey });
  const sockets = new WebSocketServer({ server });
  const requests: unknown[] = [];
  const urls: (string | undefined)[] = [];
  const authorization: (string | undefined)[] = [];
  const text = 'Synthetic Realtime answer.';
  const textFields = {
    content_index: 0,
    item_id: 'msg_example',
    output_index: 0,
    response_id: 'resp_example',
  };
  const events: RealtimeServerEvent[] = [
    {
      ...textFields,
      type: 'response.output_text.delta',
      event_id: 'event_delta',
      delta: text,
    },
    {
      ...textFields,
      type: 'response.output_text.done',
      event_id: 'event_text_done',
      text,
    },
  ];
  if (scenario !== 'clean close' && scenario !== 'abrupt close') {
    events.push({
      type: 'response.done',
      event_id: 'event_response_done',
      response: {
        id: 'resp_example',
        object: 'realtime.response',
        status: scenario,
        output: [
          {
            id: 'msg_example',
            type: 'message',
            role: 'assistant',
            status: scenario === 'completed' ? 'completed' : 'incomplete',
            content: [{ type: 'output_text', text }],
          },
        ],
        metadata: { note: 'SYNTHETIC_PRIVATE_RESPONSE_METADATA' },
      },
    });
  }
  sockets.on('connection', (socket, request) => {
    urls.push(request.url);
    authorization.push(request.headers.authorization);
    socket.on('message', (data) => {
      const event: unknown = JSON.parse(data.toString());
      requests.push(event);
      if (
        typeof event === 'object' &&
        event !== null &&
        'type' in event &&
        event.type === 'response.create'
      ) {
        if (scenario === 'abrupt close') {
          socket.terminate();
        } else {
          for (const responseEvent of events) {
            socket.send(JSON.stringify(responseEvent));
          }
          if (scenario === 'clean close') {
            socket.close(1000, 'SYNTHETIC_PRIVATE_CLOSE_REASON');
          }
        }
      }
    });
  });

  try {
    await writeFile(
      certificatePath,
      Buffer.concat([inheritedCertificateAuthority, Buffer.from('\n'), lab.certificateAuthority]),
    );
    if (provider === 'azure') {
      await writeFile(
        identityPath,
        `const Module = require('node:module');
const load = Module._load;
Module._load = function(request, ...args) {
  if (request === '@azure/identity') return {
    DefaultAzureCredential: class {},
    getBearerTokenProvider: () => async () => ${JSON.stringify(azureToken)},
  };
  return Reflect.apply(load, this, [request, ...args]);
};
`,
      );
    }
    const listening = once(server, 'listening');
    server.listen(0, '127.0.0.1');
    await listening;
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected a loopback TCP server address');
    }

    const root = process.cwd();
    const child = spawn(
      process.execPath,
      [
        path.join(root, 'node_modules/ts-node/dist/bin.js'),
        '--swc',
        ...(provider === 'azure' ? ['-r', identityPath] : []),
        '-r',
        path.join(root, 'node_modules/tsconfig-paths/register.js'),
        ...(example === 'guide'
          ? ['--eval', guideSnippet]
          : [
              path.join(
                root,
                'examples',
                ...(provider === 'azure' ? ['azure'] : []),
                'realtime',
                `${example}.ts`,
              ),
            ]),
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          OPENAI_API_KEY: 'synthetic-example-key',
          OPENAI_ADMIN_KEY: undefined,
          ...(provider === 'azure'
            ? { AZURE_OPENAI_ENDPOINT: `https://127.0.0.1:${address.port}`, OPENAI_BASE_URL: undefined }
            : { OPENAI_BASE_URL: `https://127.0.0.1:${address.port}/v1`, AZURE_OPENAI_ENDPOINT: undefined }),
          AZURE_OPENAI_API_KEY: undefined,
          OPENAI_CUSTOM_HEADERS: undefined,
          OPENAI_LOG: 'off',
          NODE_EXTRA_CA_CERTS: certificatePath,
          DOTENV_CONFIG_PATH: path.join(directory, '.env'),
          TS_NODE_PROJECT: path.join(root, 'tsconfig.json'),
          DISABLE_V8_COMPILE_CACHE: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 15_000,
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf-8').on('data', (data: string) => {
      stdout += data;
    });
    child.stderr.setEncoding('utf-8').on('data', (data: string) => {
      stderr += data;
    });

    try {
      const [exitCode, signal] = await once(child, 'close');
      expect(signal).toBeNull();
      expect(urls).toEqual([
        provider === 'azure'
          ? '/openai/v1/realtime?model=gpt-4o-realtime-preview-1001'
          : '/v1/realtime?model=gpt-realtime',
      ]);
      if (provider === 'azure') {
        expect(authorization).toEqual([`Bearer ${azureToken}`]);
      } else if (example === 'guide') {
        expect(authorization).toEqual(['Bearer synthetic-example-key']);
      }
      expect(requests).toEqual([
        {
          type: 'session.update',
          session: { output_modalities: ['text'], type: 'realtime' },
        },
        {
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Say a couple paragraphs!' }],
          },
        },
        { type: 'response.create' },
      ]);
      if (scenario !== 'abrupt close') {
        expect(stdout).toContain(text);
      }
      expect(stdout).toContain('Connection closed!');
      expect(stdout + stderr).not.toContain('synthetic-example-key');
      expect(stdout + stderr).not.toContain(azureToken);
      expect(stdout + stderr).not.toContain('SYNTHETIC_PRIVATE_RESPONSE_METADATA');
      expect(stdout + stderr).not.toContain('SYNTHETIC_PRIVATE_CLOSE_REASON');
      expect(exitCode).toBe(scenario === 'completed' ? 0 : 1);
      const closedEarly = scenario === 'clean close' || scenario === 'abrupt close';
      expect(stderr.includes('Response did not complete successfully.')).toBe(
        scenario !== 'completed' && !closedEarly,
      );
      expect(stderr.includes('WebSocket closed before the response completed.')).toBe(closedEarly);
    } finally {
      child.kill();
    }
  } finally {
    for (const socket of sockets.clients) {
      socket.terminate();
    }
    const socketsClosed = once(sockets, 'close');
    sockets.close();
    await socketsClosed;
    if (server.listening) {
      const serverClosed = once(server, 'close');
      server.close();
      server.closeAllConnections();
      await serverClosed;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
