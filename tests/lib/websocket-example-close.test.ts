import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';

import type {
  Response,
  ResponseFunctionToolCall,
  ResponsesClientEvent,
  ResponsesServerEvent,
} from 'openai/resources/responses/responses';
import { expect, test } from 'vitest';
import { WebSocketServer } from 'ws';

interface Reply {
  events: ResponsesServerEvent[];
  close?: 'clean' | 'abrupt';
}

const textEvent: ResponsesServerEvent = {
  type: 'response.output_text.delta',
  content_index: 0,
  delta: 'Synthetic answer',
  item_id: 'msg_example',
  logprobs: [],
  output_index: 0,
  sequence_number: 1,
};

function completed(responseID: string, output: Response['output'] = []): ResponsesServerEvent {
  return {
    type: 'response.completed',
    sequence_number: 2,
    response: {
      id: responseID,
      object: 'response',
      created_at: 1,
      status: 'completed',
      error: null,
      incomplete_details: null,
      instructions: null,
      metadata: null,
      model: 'gpt-5.2',
      output,
      output_text: '',
      parallel_tool_calls: false,
      temperature: null,
      tool_choice: 'auto',
      tools: [],
      top_p: null,
    },
  };
}

async function runExample(reply: (request: ResponsesClientEvent, index: number) => Reply) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected a local TCP address');
  }
  const requests: ResponsesClientEvent[] = [];
  server.on('connection', (socket) => {
    socket.on('message', (data) => {
      const request = JSON.parse(data.toString()) as ResponsesClientEvent;
      requests.push(request);
      const response = reply(request, requests.length);
      for (const event of response.events) {
        socket.send(JSON.stringify(event));
      }
      if (response.close === 'clean') {
        socket.close(1000, 'SYNTHETIC_PRIVATE_CLOSE_REASON');
      } else if (response.close === 'abrupt') {
        socket.terminate();
      }
    });
  });

  const root = process.cwd();
  const child = spawn(
    process.execPath,
    [
      path.join(root, 'node_modules/ts-node/dist/bin.js'),
      '-T',
      '-r',
      path.join(root, 'node_modules/tsconfig-paths/register.js'),
      path.join(root, 'examples/responses/websocket.ts'),
    ],
    {
      cwd: root,
      env: {
        OPENAI_API_KEY: 'synthetic-example-key',
        OPENAI_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
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
    expect(stdout + stderr).not.toContain('synthetic-example-key');
    expect(stdout + stderr).not.toContain('SYNTHETIC_PRIVATE_CLOSE_REASON');
    return { exitCode, stdout, stderr, requests };
  } finally {
    child.kill();
    for (const socket of server.clients) {
      socket.terminate();
    }
    const closed = once(server, 'close');
    server.close();
    await closed;
  }
}

test.each(['clean', 'abrupt'] as const)('reports a %s close before the response completes', async (close) => {
  const result = await runExample(() => ({ events: close === 'clean' ? [textEvent] : [], close }));

  expect(result.requests).toHaveLength(1);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain('WebSocket closed before the response completed.');
  expect(result.stdout).not.toContain('Assistant:');
  expect(result.stdout).not.toContain('=== Turn 2 ===');
});

test('completes all turns and closes normally without reporting an unfinished response', async () => {
  const result = await runExample((request, index) => {
    const responseID = `resp_${index}`;
    if (typeof request.tool_choice === 'object' && request.tool_choice?.type === 'function') {
      const call: ResponseFunctionToolCall = {
        id: `fc_${index}`,
        type: 'function_call',
        call_id: `call_${index}`,
        name: request.tool_choice.name,
        arguments: '{"sku":"sku-example"}',
        status: 'completed',
      };
      return {
        events: [
          { type: 'response.output_item.done', output_index: 0, sequence_number: 1, item: call },
          completed(responseID, [call]),
        ],
      };
    }
    return { events: [textEvent, completed(responseID)] };
  });

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.requests).toHaveLength(6);
  expect(result.stdout.match(/Assistant: Synthetic answer/gu)).toHaveLength(3);
  expect(result.requests.map((request) => request.previous_response_id)).toEqual([
    null,
    'resp_1',
    'resp_2',
    'resp_3',
    'resp_4',
    'resp_5',
  ]);
});

test('preserves an API failure when the server closes immediately afterward', async () => {
  const result = await runExample(() => ({
    events: [
      {
        type: 'error',
        error: {
          code: 'invalid_request',
          message: 'Synthetic API failure',
          param: null,
          type: 'invalid_request_error',
        },
        status: 400,
      },
    ],
    close: 'clean',
  }));

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain('Synthetic API failure');
  expect(result.stderr).not.toContain('WebSocket closed before the response completed.');
  expect(result.requests).toHaveLength(1);
});
