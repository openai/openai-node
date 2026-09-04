import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import path from 'node:path';
import { inspect } from 'node:util';
import type {
  Response,
  ResponseFunctionToolCall,
  ResponseOutputItem,
  ResponseOutputMessage,
} from 'openai/resources/responses/responses';

const root = process.cwd();
const query = { table_name: 'orders', columns: ['id'], conditions: [], order_by: 'asc' };
const toolCall: ResponseFunctionToolCall = {
  type: 'function_call',
  id: 'fc_synthetic',
  call_id: 'call_synthetic',
  name: 'query',
  arguments: JSON.stringify(query),
  status: 'completed',
};
const message: ResponseOutputMessage = {
  type: 'message',
  id: 'msg_synthetic',
  role: 'assistant',
  status: 'completed',
  content: [{ type: 'output_text', text: 'I will query those orders.', annotations: [] }],
};

async function runExample(baseURL: string) {
  const child = spawn(
    process.execPath,
    [
      path.join(root, 'node_modules/ts-node/dist/bin.js'),
      '--swc',
      '-r',
      path.join(root, 'node_modules/tsconfig-paths/register.js'),
      path.join(root, 'examples/responses/structured-outputs-tools.ts'),
    ],
    {
      cwd: root,
      env: {
        OPENAI_API_KEY: 'synthetic-query-example-key',
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
    },
  );
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

const cases: { name: string; output: ResponseOutputItem[]; succeeds: boolean }[] = [
  { name: 'function call first', output: [toolCall], succeeds: true },
  { name: 'message before function call', output: [message, toolCall], succeeds: true },
  { name: 'message without a function call', output: [message], succeeds: false },
  { name: 'empty output', output: [], succeeds: false },
];

test.each(cases)('structured-output tool example: $name', async ({ output, succeeds }) => {
  const requests: {
    method: string | undefined;
    url: string | undefined;
    authorization: string | undefined;
    body: Buffer;
  }[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks);
      requests.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
        body,
      });
      const responseBody: Omit<Response, 'output_text'> = {
        id: 'resp_synthetic',
        object: 'response',
        created_at: 0,
        status: 'completed',
        error: null,
        incomplete_details: null,
        instructions: null,
        metadata: {},
        model: 'gpt-4o-2024-08-06',
        output,
        parallel_tool_calls: true,
        temperature: 1,
        tool_choice: 'auto',
        tools: JSON.parse(body.toString()).tools,
        top_p: 1,
      };
      response.writeHead(200, { 'content-type': 'application/json', connection: 'close' });
      response.end(JSON.stringify(responseBody));
    });
  });

  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected a loopback HTTP address');
    }
    const result = await runExample(`http://127.0.0.1:${address.port}/v1`);

    expect(requests).toHaveLength(1);
    const [request] = requests;
    if (!request) {
      throw new Error('Expected the example to send a request');
    }
    expect(request).toMatchObject({
      method: 'POST',
      url: '/v1/responses',
      authorization: 'Bearer synthetic-query-example-key',
    });
    expect(JSON.parse(request.body.toString()).tools).toEqual([
      expect.objectContaining({ type: 'function', name: 'query', strict: true }),
    ]);
    expect(result.signal).toBeNull();
    expect(result.stdout + result.stderr).not.toContain('synthetic-query-example-key');
    if (succeeds) {
      expect(result.stderr).toBe('');
      expect(result.code).toBe(0);
      expect(result.stdout.trimEnd().endsWith(inspect(query))).toBe(true);
    } else {
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('Expected function call');
      expect(result.stderr).not.toContain('TypeError');
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
