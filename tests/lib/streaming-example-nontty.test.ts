import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import path from 'node:path';

import type {
  ChatCompletionChunk,
  ChatCompletionCreateParamsStreaming,
} from 'openai/resources/chat/completions';
import { expect, test } from 'vitest';

const examples = ['function-call-stream.ts', 'function-call-stream-raw.ts', 'tool-calls-stream.ts'] as const;

test.each(examples)('%s completes a tool round trip with redirected stdout', async (filename) => {
  const usesTools = filename === 'tool-calls-stream.ts';
  const requests: ChatCompletionCreateParamsStreaming[] = [];
  const server = createServer((request, response) => {
    let body = '';
    request.setEncoding('utf-8').on('data', (chunk: string) => {
      body += chunk;
    });
    request.on('end', () => {
      requests.push(JSON.parse(body) as ChatCompletionCreateParamsStreaming);
      let deltas: ChatCompletionChunk.Choice.Delta[];
      if (requests.length > 1) {
        deltas = [{ role: 'assistant', content: 'Synthetic ' }, { content: 'recommendation.' }];
      } else if (usesTools) {
        deltas = [
          {
            role: 'assistant',
            tool_calls: [
              {
                index: 0,
                id: 'call_example',
                type: 'function',
                function: { name: 'list', arguments: '{"genre":' },
              },
            ],
          },
          { tool_calls: [{ index: 0, function: { arguments: '"historical"}' } }] },
        ];
      } else {
        deltas = [
          { role: 'assistant', function_call: { name: 'list', arguments: '{"genre":' } },
          { function_call: { arguments: '"historical"}' } },
        ];
      }

      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      for (const delta of deltas) {
        const chunk: ChatCompletionChunk = {
          id: 'chatcmpl_example',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'gpt-3.5-turbo',
          choices: [{ index: 0, delta, finish_reason: null }],
        };
        response.write(`data: ${JSON.stringify(chunk)}\n\n`);
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
      path.join(root, 'examples/chat-completions', filename),
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
    expect(stdout).toContain('Synthetic recommendation.');
    expect(stdout.match(/Synthetic /gu)).toHaveLength(1);
    expect(stdout).not.toContain('\u001B[');
    expect(stdout).not.toContain('synthetic-example-key');
    expect(requests).toHaveLength(2);
    expect(requests[0]?.stream).toBe(true);
    const messages = requests[1]?.messages;
    expect(messages).toHaveLength(4);
    const result = messages?.[3];
    expect(result?.role).toBe(usesTools ? 'tool' : 'function');
    expect(JSON.parse(String(result?.content))).toEqual([
      { name: 'To Kill a Mockingbird', id: 'a1' },
      { name: 'All the Light We Cannot See', id: 'a2' },
      { name: 'Where the Crawdads Sing', id: 'a3' },
    ]);
    if (usesTools) {
      expect(result).toHaveProperty('tool_call_id', 'call_example');
    } else {
      expect(result).toHaveProperty('name', 'list');
    }
  } finally {
    child.kill();
    const closed = once(server, 'close');
    server.closeAllConnections();
    server.close();
    await closed;
  }
});
