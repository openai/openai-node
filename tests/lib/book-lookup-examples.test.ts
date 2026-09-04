import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import path from 'node:path';
import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionCreateParams,
  ChatCompletionMessage,
} from 'openai/resources/chat/completions';

const root = process.cwd();
const examples = [
  { file: 'function-call-diy.ts', streaming: false, tool: false },
  { file: 'function-call.ts', streaming: false, tool: false },
  { file: 'function-call-stream-raw.ts', streaming: true, tool: false },
  { file: 'function-call-stream.ts', streaming: true, tool: false },
  { file: 'tool-calls-stream.ts', streaming: true, tool: true },
];
const cases = examples.flatMap((example) => ['a1', 'book-does-not-exist'].map((id) => ({ ...example, id })));

async function runExample(file: string, baseURL: string) {
  // These examples expect terminal cursor methods. Use Node's real operations so
  // their independent redirected-output limitation does not hide lookup results.
  const bootstrap = `
    const readline = require('node:readline');
    Object.assign(process.stdout, {
      columns: 80,
      isTTY: true,
      cursorTo: (...args) => readline.cursorTo(process.stdout, ...args),
      moveCursor: (...args) => readline.moveCursor(process.stdout, ...args),
      clearScreenDown: (...args) => readline.clearScreenDown(process.stdout, ...args),
    });
    require(${JSON.stringify(path.join(root, 'node_modules/ts-node'))}).register({ swc: true });
    require(${JSON.stringify(path.join(root, 'node_modules/tsconfig-paths/register.js'))});
    require(${JSON.stringify(path.join(root, 'examples/chat-completions', file))});
  `;
  const child = spawn(process.execPath, ['-e', bootstrap], {
    cwd: root,
    env: {
      OPENAI_API_KEY: 'synthetic-book-lookup-key',
      OPENAI_BASE_URL: baseURL,
      OPENAI_LOG: 'off',
      TS_NODE_PROJECT: path.join(root, 'tsconfig.json'),
      TS_NODE_TRANSPILE_ONLY: 'true',
      DISABLE_V8_COMPILE_CACHE: '1',
      NO_PROXY: '127.0.0.1',
      no_proxy: '127.0.0.1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 15_000,
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf-8').on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.setEncoding('utf-8').on('data', (chunk: string) => {
    stderr += chunk;
  });
  try {
    const [code, signal] = await once(child, 'close');
    return { code, signal, stdout, stderr };
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
    }
  }
}

function completionChunk(
  delta: ChatCompletionChunk.Choice.Delta,
  finishReason: ChatCompletionChunk.Choice['finish_reason'],
): ChatCompletionChunk {
  return {
    id: 'chatcmpl_synthetic',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'gpt-3.5-turbo',
    choices: [{ index: 0, delta, finish_reason: finishReason, logprobs: null }],
  };
}

test.each(cases)('$file serializes get($id) results', async ({ file, streaming, tool, id }) => {
  const requests: {
    method: string | undefined;
    url: string | undefined;
    authorization: string | undefined;
    body: ChatCompletionCreateParams;
  }[] = [];
  const server = createServer((request, response) => {
    const buffers: Buffer[] = [];
    request.on('data', (buffer: Buffer) => buffers.push(buffer));
    request.on('end', () => {
      requests.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
        body: JSON.parse(Buffer.concat(buffers).toString()),
      });
      const first = requests.length === 1;
      if (streaming) {
        const firstDelta: ChatCompletionChunk.Choice.Delta = tool
          ? {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: 'call_synthetic',
                  type: 'function',
                  function: { name: 'get', arguments: '{"id":' },
                },
              ],
            }
          : { role: 'assistant', function_call: { name: 'get', arguments: '{"id":' } };
        const finalArguments = `${JSON.stringify(id)}}`;
        const secondDelta: ChatCompletionChunk.Choice.Delta = tool
          ? { tool_calls: [{ index: 0, function: { arguments: finalArguments } }] }
          : { function_call: { arguments: finalArguments } };
        const chunks = first
          ? [
              completionChunk(firstDelta, null),
              completionChunk(secondDelta, null),
              completionChunk({}, tool ? 'tool_calls' : 'function_call'),
            ]
          : [completionChunk({ role: 'assistant', content: 'Synthetic lookup complete.' }, 'stop')];
        response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'close' });
        const events = chunks.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
        response.end(`${events}data: [DONE]\n\n`);
      } else {
        const message: ChatCompletionMessage = {
          role: 'assistant',
          content: first ? null : 'Synthetic lookup complete.',
          refusal: null,
          ...(first ? { function_call: { name: 'get', arguments: JSON.stringify({ id }) } } : {}),
        };
        const completion: ChatCompletion = {
          id: 'chatcmpl_synthetic',
          object: 'chat.completion',
          created: 0,
          model: 'gpt-3.5-turbo',
          choices: [{ index: 0, message, finish_reason: first ? 'function_call' : 'stop', logprobs: null }],
        };
        response.writeHead(200, { 'content-type': 'application/json', connection: 'close' });
        response.end(JSON.stringify(completion));
      }
    });
  });

  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected a loopback HTTP address');
    }
    const result = await runExample(file, `http://127.0.0.1:${address.port}/v1`);
    expect(result).toMatchObject({ code: 0, signal: null, stderr: '' });
    expect(result.stdout).toContain('Synthetic lookup complete.');
    expect(result.stdout + result.stderr).not.toContain('synthetic-book-lookup-key');
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request).toMatchObject({
        method: 'POST',
        url: '/v1/chat/completions',
        authorization: 'Bearer synthetic-book-lookup-key',
      });
      expect(Boolean(request.body.stream)).toBe(streaming);
    }
    const [first, second] = requests;
    if (!first || !second) {
      throw new Error('Expected the initial request and lookup result request');
    }
    expect(first.body.messages).toHaveLength(2);
    expect(second.body.messages).toHaveLength(4);
    const functions = tool
      ? first.body.tools?.flatMap((entry) => (entry.type === 'function' ? [entry.function] : []))
      : first.body.functions;
    expect(functions).toContainEqual(
      expect.objectContaining({
        name: 'get',
        parameters: expect.objectContaining({ properties: { id: { type: 'string' } } }),
      }),
    );
    const lookup = second.body.messages.find((message) => message.role === (tool ? 'tool' : 'function'));
    expect(lookup).toMatchObject(
      tool
        ? { role: 'tool', name: 'get', tool_call_id: 'call_synthetic' }
        : { role: 'function', name: 'get' },
    );
    if (id === 'a1') {
      if (typeof lookup?.content !== 'string') {
        throw new TypeError('Expected a serialized book');
      }
      expect(JSON.parse(lookup.content)).toEqual({
        id: 'a1',
        name: 'To Kill a Mockingbird',
        genre: 'historical',
        description: expect.stringContaining('Harper Lee'),
      });
    } else {
      expect(lookup?.content).toBe('null');
    }
  } finally {
    if (server.listening) {
      const closed = once(server, 'close');
      server.close();
      server.closeAllConnections();
      await closed;
    }
  }
});
