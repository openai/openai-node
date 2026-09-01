import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { RealtimeServerEvent } from 'openai/resources/realtime/realtime';
import { expect, test } from 'vitest';
import { WebSocketServer } from 'ws';

import { createX509TestLab } from '../utils/x509-test-lab';

const cases = (['ws', 'websocket'] as const).flatMap((example) =>
  (['completed', 'failed', 'cancelled', 'incomplete'] as const).map((status) => ({ example, status })),
);

test.each(cases)('Realtime $example example handles a $status response', async ({ example, status }) => {
  const lab = createX509TestLab();
  const directory = await mkdtemp(path.join(tmpdir(), 'openai-realtime-example-'));
  const certificatePath = path.join(directory, 'ca.pem');
  const server = createServer({ cert: lab.server.certificate, key: lab.server.privateKey });
  const sockets = new WebSocketServer({ server });
  const requests: unknown[] = [];
  const urls: (string | undefined)[] = [];
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
    {
      type: 'response.done',
      event_id: 'event_response_done',
      response: {
        id: 'resp_example',
        object: 'realtime.response',
        status,
        output: [
          {
            id: 'msg_example',
            type: 'message',
            role: 'assistant',
            status: status === 'completed' ? 'completed' : 'incomplete',
            content: [{ type: 'output_text', text }],
          },
        ],
        metadata: { note: 'SYNTHETIC_PRIVATE_RESPONSE_METADATA' },
      },
    },
  ];
  sockets.on('connection', (socket, request) => {
    urls.push(request.url);
    socket.on('message', (data) => {
      const event: unknown = JSON.parse(data.toString());
      requests.push(event);
      if (
        typeof event === 'object' &&
        event !== null &&
        'type' in event &&
        event.type === 'response.create'
      ) {
        for (const responseEvent of events) {
          socket.send(JSON.stringify(responseEvent));
        }
      }
    });
  });

  try {
    await writeFile(certificatePath, lab.certificateAuthority);
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
        '-T',
        '-r',
        path.join(root, 'node_modules/tsconfig-paths/register.js'),
        path.join(root, 'examples/realtime', `${example}.ts`),
      ],
      {
        cwd: root,
        env: {
          OPENAI_API_KEY: 'synthetic-example-key',
          OPENAI_BASE_URL: `https://127.0.0.1:${address.port}/v1`,
          NODE_EXTRA_CA_CERTS: certificatePath,
          TS_NODE_PROJECT: path.join(root, 'tsconfig.json'),
          DISABLE_V8_COMPILE_CACHE: '1',
          SystemRoot: process.env['SystemRoot'],
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
      expect(urls).toEqual(['/v1/realtime?model=gpt-realtime']);
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
      expect(stdout).toContain(text);
      expect(stdout).toContain('Connection closed!');
      expect(stdout + stderr).not.toContain('synthetic-example-key');
      expect(stdout + stderr).not.toContain('SYNTHETIC_PRIVATE_RESPONSE_METADATA');
      expect(exitCode).toBe(status === 'completed' ? 0 : 1);
      expect(stderr.includes('Response did not complete successfully.')).toBe(status !== 'completed');
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
