import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { devNull } from 'node:os';
import path from 'node:path';

const root = process.cwd();
const credential = 'synthetic-nonstreaming-example-credential';
const rejection = 'Synthetic nonstreaming API rejection';
const completionText = 'Synthetic completion';
const greeting = 'Synthetic Bedrock greeting';
const math = {
  steps: [{ explanation: 'Subtract 31 and divide by 8.', output: '-29 / 8' }],
  final_answer: '-29 / 8',
};
const examples = [
  { file: 'client/raw-response.ts', kind: 'raw', model: 'gpt-3.5-turbo-instruct' },
  { file: 'responses/structured-outputs.ts', kind: 'structured', model: 'gpt-4o-2024-08-06' },
  { file: 'bedrock/responses.ts', kind: 'bedrock', model: 'openai.gpt-5.4' },
] as const;

async function runExample(file: string, baseURL: string, bedrock: boolean) {
  const child = spawn(
    process.execPath,
    [
      path.join(root, 'node_modules/ts-node/dist/bin.js'),
      '--swc',
      '-r',
      path.join(root, 'node_modules/tsconfig-paths/register.js'),
      path.join(root, 'examples', file),
    ],
    {
      cwd: root,
      // Never inherit real credentials, profiles, proxy settings, or Node preload hooks.
      env: {
        ...(bedrock
          ? { AWS_BEDROCK_BASE_URL: baseURL, AWS_BEARER_TOKEN_BEDROCK: credential }
          : { OPENAI_BASE_URL: baseURL, OPENAI_API_KEY: credential }),
        AWS_SHARED_CREDENTIALS_FILE: devNull,
        AWS_CONFIG_FILE: devNull,
        AWS_EC2_METADATA_DISABLED: 'true',
        OPENAI_LOG: 'off',
        TS_NODE_PROJECT: path.join(root, 'tsconfig.json'),
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

describe.each(examples)('$file exit status', ({ file, kind, model }) => {
  const scenarios = ['HTTP rejection', 'invalid JSON', 'success'];
  if (kind === 'raw') {
    scenarios.push('second request rejection');
  }

  test.each(scenarios)('%s', async (scenario) => {
    const requests: {
      method: string | undefined;
      url: string | undefined;
      authorization: string | undefined;
      body: string;
    }[] = [];
    const server = createServer((request, response) => {
      let body = '';
      request.setEncoding('utf-8').on('data', (chunk: string) => {
        body += chunk;
      });
      request.on('end', () => {
        requests.push({
          method: request.method,
          url: request.url,
          authorization: request.headers.authorization,
          body,
        });
        const rejected =
          scenario === 'HTTP rejection' || (scenario === 'second request rejection' && requests.length === 2);
        response.writeHead(rejected ? 400 : 200, { 'content-type': 'application/json', connection: 'close' });
        if (rejected) {
          response.end(JSON.stringify({ error: { message: rejection, type: 'invalid_request_error' } }));
        } else if (scenario === 'invalid JSON') {
          response.end('{invalid json');
        } else if (kind === 'raw') {
          response.end(
            JSON.stringify({
              id: 'cmpl_synthetic',
              object: 'text_completion',
              created: 0,
              model,
              choices: [{ text: completionText, index: 0, finish_reason: 'stop', logprobs: null }],
            }),
          );
        } else {
          response.end(
            JSON.stringify({
              id: 'resp_synthetic',
              object: 'response',
              created_at: 0,
              status: 'completed',
              model,
              error: null,
              incomplete_details: null,
              instructions: null,
              metadata: {},
              output: [
                {
                  id: 'msg_synthetic',
                  type: 'message',
                  role: 'assistant',
                  status: 'completed',
                  content: [
                    {
                      type: 'output_text',
                      text: kind === 'bedrock' ? greeting : JSON.stringify(math),
                      annotations: [],
                    },
                  ],
                },
              ],
              parallel_tool_calls: true,
              temperature: 1,
              tool_choice: 'auto',
              tools: [],
              top_p: 1,
            }),
          );
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
      const result = await runExample(file, `http://127.0.0.1:${address.port}/v1`, kind === 'bedrock');

      expect(result.signal).toBeNull();
      expect(result.stdout + result.stderr).not.toContain(credential);
      const expectedRequests =
        kind === 'raw' && ['success', 'second request rejection'].includes(scenario) ? 2 : 1;
      expect(requests).toHaveLength(expectedRequests);
      for (const { body, ...request } of requests) {
        expect(request).toEqual({
          method: 'POST',
          url: `/v1/${kind === 'raw' ? 'completions' : 'responses'}`,
          authorization: `Bearer ${credential}`,
        });
        expect(JSON.parse(body)).toMatchObject({
          model,
          ...(kind === 'raw'
            ? { prompt: 'Say this is a test' }
            : { input: kind === 'bedrock' ? 'Say hello!' : 'solve 8x + 31 = 2' }),
        });
        if (kind === 'structured') {
          expect(JSON.parse(body).text.format).toMatchObject({
            type: 'json_schema',
            name: 'math_response',
            strict: true,
          });
        }
      }

      if (scenario === 'success') {
        expect(result.stderr).toBe('');
        if (kind === 'raw') {
          expect(result.stdout.match(/response headers:/gu)).toHaveLength(2);
          expect(result.stdout).toContain('response json:');
          expect(result.stdout).toContain('completion:');
          expect(result.stdout.match(/Synthetic completion/gu)).toHaveLength(2);
        } else {
          expect(result.stdout).toContain(kind === 'bedrock' ? greeting : 'answer: -29 / 8');
        }
        expect(result.code).toBe(0);
      } else {
        expect(result.stderr).toContain(scenario === 'invalid JSON' ? 'SyntaxError' : rejection);
        if (kind === 'raw' && scenario !== 'HTTP rejection') {
          expect(result.stdout).toContain('response headers:');
          expect(result.stdout).not.toContain('completion:');
          if (scenario === 'second request rejection') {
            expect(result.stdout).toContain('response json:');
            expect(result.stdout).toContain(completionText);
          }
        } else {
          expect(result.stdout).toBe('');
        }
        expect(result.code).toBe(1);
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
});
