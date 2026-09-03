import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import OpenAI from 'openai';
import type { BetaResponse, BetaResponsesServerEvent } from 'openai/resources/beta/responses/responses';
import { ResponsesWS } from 'openai/resources/beta/responses/ws';
import ts from 'typescript';
import { expect, test, vi } from 'vitest';
import { WebSocketServer } from 'ws';

const filename = 'examples/responses/multi-agent-websocket.ts';
const source = ts.transpileModule(readFileSync(filename, 'utf-8'), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
}).outputText;

type TerminalStatus = 'completed' | 'failed' | 'incomplete';
type TerminalEvent = Extract<BetaResponsesServerEvent, { type: `response.${TerminalStatus}` }>;

function terminalEvent(status: TerminalStatus): TerminalEvent {
  const response: BetaResponse = {
    id: 'resp_example',
    object: 'response',
    created_at: 1,
    status,
    error: status === 'failed' ? { code: 'server_error', message: 'Synthetic server failure' } : null,
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
  return { type: `response.${status}`, sequence_number: 2, response };
}

const textEvent: BetaResponsesServerEvent = {
  type: 'response.output_text.delta',
  content_index: 0,
  delta: 'Synthetic answer',
  item_id: 'msg_example',
  logprobs: [],
  output_index: 0,
  sequence_number: 1,
};

async function runExample(events: BetaResponsesServerEvent[], writeFailure?: Error) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected a local TCP address');
  }
  const baseURL = `http://127.0.0.1:${address.port}/v1`;

  class LocalOpenAI extends OpenAI {
    constructor() {
      super({
        apiKey: 'synthetic-example-key',
        baseURL,
        organization: null,
        project: null,
      });
    }
  }

  const closeCodes: number[] = [];
  const requests: unknown[] = [];
  const output: string[] = [];
  server.on('connection', (socket) => {
    socket.once('close', (code) => closeCodes.push(code));
    socket.once('message', (data) => {
      requests.push(JSON.parse(data.toString()));
      for (const event of events) {
        socket.send(JSON.stringify(event));
      }
      // Keep the server open: the one-response example owns closing its connection.
    });
  });

  let outcome: Promise<{ error: unknown }> | undefined;
  try {
    const main = runInNewContext(
      source,
      {
        exports: {},
        require(name: string) {
          if (name === 'openai') {
            return { __esModule: true, default: LocalOpenAI };
          }
          if (name === 'openai/resources/beta/responses/ws') {
            return { ResponsesWS };
          }
          throw new Error(`Unexpected example import: ${name}`);
        },
        process: {
          stdout: {
            write(value: string) {
              if (writeFailure) {
                throw writeFailure;
              }
              output.push(value);
              return true;
            },
          },
        },
      },
      { filename },
    ) as Promise<void>;
    outcome = (async () => {
      try {
        await main;
        return { error: undefined };
      } catch (error) {
        return { error };
      }
    })();

    await vi.waitFor(() => expect(requests).toHaveLength(1), { timeout: 2000 });
    await vi.waitFor(() => expect(closeCodes).toEqual([1000]), { timeout: 2000 });
    expect(requests[0]).toMatchObject({
      type: 'response.create',
      model: 'gpt-5.6-sol',
      multi_agent: { enabled: true },
    });
    return { ...(await outcome), output: output.join('') };
  } finally {
    for (const socket of server.clients) {
      socket.terminate();
    }
    const closed = once(server, 'close');
    server.close();
    await closed;
    await outcome;
  }
}

test('closes the multi-agent WebSocket example after a completed response', async () => {
  const result = await runExample([textEvent, terminalEvent('completed')]);

  expect(result.error).toBeUndefined();
  expect(result.output).toBe('━━━ Coordinator: /root ━━━\n\nSynthetic answer\n');
});

test.each([
  ['failed', false],
  ['failed', true],
  ['incomplete', false],
  ['incomplete', true],
] as const)(
  'rejects and closes the example after a %s response (partial output: %s)',
  async (status, partialOutput) => {
    const result = await runExample([...(partialOutput ? [textEvent] : []), terminalEvent(status)]);

    expect(result.error).toMatchObject({ message: `Response ended with response.${status}.` });
    expect(result.output).toBe(partialOutput ? '━━━ Coordinator: /root ━━━\n\nSynthetic answer' : '');
  },
);

test.each(['completed', 'failed', 'incomplete'] as const)(
  'keeps receiving the coordinator response after a child response is %s',
  async (status) => {
    const childEvent = terminalEvent(status);
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
      {
        ...childEvent,
        response: { ...childEvent.response, id: 'resp_child' },
        agent: { agent_name: '/root/alpha' },
      },
      {
        ...textEvent,
        item_id: 'msg_root',
        delta: 'Coordinator summary',
        output_index: 1,
        sequence_number: 3,
      },
      { ...terminalEvent('completed'), sequence_number: 4, agent: { agent_name: '/root' } },
    ]);

    expect(result.error).toBeUndefined();
    expect(result.output).toBe(
      '━━━ Agent: /root/alpha ━━━\n\nSynthetic answer\n\n━━━ Coordinator: /root ━━━\n\nCoordinator summary\n',
    );
  },
);

test.each([
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
  {
    type: 'error',
    code: 'invalid_request',
    message: 'Synthetic API failure',
    param: null,
    sequence_number: 0,
  },
] satisfies BetaResponsesServerEvent[])('closes the example after API error %#', async (event) => {
  const result = await runExample([event]);

  expect(result.error).toMatchObject({ message: 'Synthetic API failure' });
  expect(result.output).toBe('');
});

test('closes the example and preserves a failure while writing output', async () => {
  const error = new Error('Synthetic output failure');
  const result = await runExample([textEvent], error);

  expect(result.error).toBe(error);
  expect(result.output).toBe('');
});
