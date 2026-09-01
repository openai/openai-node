import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import path from 'node:path';

import type { Response, ResponseStreamEvent } from 'openai/resources/responses/responses';
import { expect, test } from 'vitest';

function responseEvents(chunks: readonly string[]): ResponseStreamEvent[] {
  const response: Response = {
    id: 'resp_background_example',
    object: 'response',
    created_at: 1,
    model: 'gpt-4o-2024-08-06',
    output: [],
    output_text: '',
    error: null,
    incomplete_details: null,
    instructions: null,
    metadata: null,
    parallel_tool_calls: false,
    temperature: null,
    tool_choice: 'auto',
    tools: [],
    top_p: null,
    status: 'in_progress',
    background: true,
  };
  const events: ResponseStreamEvent[] = [
    { type: 'response.created', sequence_number: 0, response },
    {
      type: 'response.output_item.added',
      sequence_number: 1,
      output_index: 0,
      item: { id: 'msg_example', type: 'message', role: 'assistant', status: 'in_progress', content: [] },
    },
    {
      type: 'response.content_part.added',
      sequence_number: 2,
      item_id: 'msg_example',
      output_index: 0,
      content_index: 0,
      part: { type: 'output_text', annotations: [], text: '' },
    },
  ];
  for (const delta of chunks) {
    events.push({
      type: 'response.output_text.delta',
      sequence_number: events.length,
      item_id: 'msg_example',
      output_index: 0,
      content_index: 0,
      delta,
      logprobs: [],
    });
  }
  const text = chunks.join('');
  events.push({
    type: 'response.completed',
    sequence_number: events.length,
    response: {
      ...response,
      status: 'completed',
      output_text: text,
      output: [
        {
          id: 'msg_example',
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', annotations: [], text }],
        },
      ],
    },
  });
  return events;
}

test.each([false, true])('background example completes (interrupted: %s)', async (interrupted) => {
  const chunks = interrupted
    ? ['Synthetic ', 'background ', 'response ', 'resumed ', 'after ', 'the ', 'demo ', 'break.']
    : ['Synthetic completion.'];
  const events = responseEvents(chunks);
  const body = `${events.map((event) => `data: ${JSON.stringify(event)}`).join('\n\n')}\n\ndata: [DONE]\n\n`;
  const requests: { method: string | undefined; url: string | undefined; body: unknown }[] = [];
  const server = createServer((request, response) => {
    let requestBody = '';
    request.setEncoding('utf-8').on('data', (chunk: string) => {
      requestBody += chunk;
    });
    request.on('end', () => {
      requests.push({
        method: request.method,
        url: request.url,
        body: requestBody ? JSON.parse(requestBody) : null,
      });
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(body);
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
      path.join(root, 'examples/responses/stream_background.ts'),
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
    expect(stderr).toBe('');
    expect(exitCode).toBe(0);
    expect(stdout).toContain(chunks.join(''));
    expect(stdout.includes('Interrupted. Continuing...')).toBe(interrupted);
    expect(stdout).not.toContain('synthetic-example-key');
    expect(requests).toHaveLength(interrupted ? 2 : 1);
    expect(requests[0]).toMatchObject({
      method: 'POST',
      url: '/v1/responses',
      body: { background: true, stream: true },
    });
    if (interrupted) {
      expect(requests[1]).toMatchObject({
        method: 'GET',
        url: '/v1/responses/resp_background_example?stream=true',
      });
    }
  } finally {
    child.kill();
    const closed = once(server, 'close');
    server.closeAllConnections();
    server.close();
    await closed;
  }
});
