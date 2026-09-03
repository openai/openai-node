import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import path from 'node:path';

import type { BetaResponse, BetaResponseStreamEvent } from 'openai/resources/beta/responses/responses';
import { expect, test } from 'vitest';

type TerminalStatus = 'completed' | 'failed' | 'incomplete';
type TerminalEvent = Extract<BetaResponseStreamEvent, { type: `response.${TerminalStatus}` }>;

function terminalEvent(status: TerminalStatus): TerminalEvent {
  const response: BetaResponse = {
    id: 'resp_example',
    object: 'response',
    created_at: 1,
    status,
    error: status === 'failed' ? { code: 'server_error', message: 'Synthetic private detail' } : null,
    incomplete_details: status === 'incomplete' ? { reason: 'max_output_tokens' } : null,
    instructions: null,
    metadata: null,
    model: 'gpt-5.6-sol',
    output: [],
    parallel_tool_calls: true,
    temperature: null,
    tool_choice: 'auto',
    tools: [],
    top_p: null,
  };
  return { type: `response.${status}`, sequence_number: 0, response };
}

const textEvent: BetaResponseStreamEvent = {
  type: 'response.output_text.delta',
  content_index: 0,
  delta: 'Synthetic answer',
  item_id: 'msg_example',
  logprobs: [],
  output_index: 0,
  sequence_number: 0,
};

async function runExample(events: BetaResponseStreamEvent[]) {
  const requests: { url: string | undefined; body: unknown }[] = [];
  const server = createServer((request, response) => {
    let body = '';
    request.setEncoding('utf-8').on('data', (chunk: string) => {
      body += chunk;
    });
    request.on('end', () => {
      requests.push({ url: request.url, body: JSON.parse(body) });
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      for (const [sequence_number, event] of events.entries()) {
        response.write(`event: ${event.type}\ndata: ${JSON.stringify({ ...event, sequence_number })}\n\n`);
      }
      response.end('data: [DONE]\n\n');
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected a local TCP address');
  }

  const root = process.cwd();
  const child = spawn(
    process.execPath,
    [
      path.join(root, 'node_modules/ts-node/dist/bin.js'),
      '-T',
      '-r',
      path.join(root, 'node_modules/tsconfig-paths/register.js'),
      path.join(root, 'examples/responses/multi-agent-streaming.ts'),
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
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      url: '/v1/responses?beta=true',
      body: { model: 'gpt-5.6-sol', multi_agent: { enabled: true }, stream: true },
    });
    expect(stdout + stderr).not.toContain('synthetic-example-key');
    return { exitCode, stdout, stderr };
  } finally {
    child.kill();
    const closed = once(server, 'close');
    server.closeAllConnections();
    server.close();
    await closed;
  }
}

test.each([
  ['failed', false, undefined],
  ['failed', true, { agent_name: '/root' }],
  ['incomplete', false, null],
  ['incomplete', true, { agent_name: '/root' }],
] as const)('reports a %s root response (partial output: %s)', async (status, partialOutput, agent) => {
  const result = await runExample([
    ...(partialOutput ? [textEvent] : []),
    { ...terminalEvent(status), ...(agent === undefined ? {} : { agent }) },
  ]);

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain(`Response ended with response.${status}.`);
  expect(result.stderr).not.toContain('Synthetic private detail');
  expect(result.stdout).toBe(partialOutput ? '━━━ Coordinator: /root ━━━\n\nSynthetic answer' : '');
});

test.each(['completed', 'failed', 'incomplete'] as const)(
  'continues to a successful root response after a child response is %s',
  async (status) => {
    const result = await runExample([
      {
        type: 'response.output_item.added',
        output_index: 0,
        sequence_number: 0,
        item: {
          id: textEvent.item_id,
          type: 'message',
          role: 'assistant',
          status: 'in_progress',
          content: [],
          agent: { agent_name: '/root/alpha' },
        },
      },
      textEvent,
      { ...terminalEvent(status), agent: { agent_name: '/root/alpha' } },
      { ...textEvent, item_id: 'msg_root', output_index: 1, delta: 'Coordinator summary' },
      { ...terminalEvent('completed'), agent: null },
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(
      '━━━ Agent: /root/alpha ━━━\n\nSynthetic answer\n\n━━━ Coordinator: /root ━━━\n\nCoordinator summary\n',
    );
  },
);

test('preserves SDK error handling for a named SSE error frame', async () => {
  const result = await runExample([
    {
      type: 'error',
      code: 'server_error',
      message: 'Synthetic SSE error',
      param: null,
      sequence_number: 0,
    },
  ]);

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain('APIError: Synthetic SSE error');
  expect(result.stdout).toBe('');
});
