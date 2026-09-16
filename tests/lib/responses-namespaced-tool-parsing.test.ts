import { once } from 'node:events';
import { createServer } from 'node:http';
import { vi } from 'vitest';
import OpenAI from 'openai';
import {
  hasAutoParseableInput,
  makeParseableResponseTool,
  parseResponse,
  shouldParseToolCall,
} from 'openai/lib/ResponsesParser';
import type {
  FunctionTool,
  NamespaceTool,
  Response,
  ResponseFunctionToolCall,
  ResponseStreamEvent,
  Tool,
} from 'openai/resources/responses/responses';

const modes = ['parse', 'stream', 'replay'] as const;
const strictTool: FunctionTool = {
  type: 'function',
  name: 'lookup',
  strict: true,
  parameters: {
    type: 'object',
    properties: { city: { type: 'string' } },
    required: ['city'],
    additionalProperties: false,
  },
};

function namespace(name: string, tools: NamespaceTool['tools']): NamespaceTool {
  return { type: 'namespace', name, description: 'Synthetic tools', tools };
}

function toolCall(scope?: string, name = 'lookup', args = '{"city":"Paris"}'): ResponseFunctionToolCall {
  return {
    type: 'function_call',
    id: `fc_${scope ?? 'top'}_${name}`,
    call_id: `call_${scope ?? 'top'}_${name}`,
    name,
    ...(scope === undefined ? {} : { namespace: scope }),
    arguments: args,
    status: 'completed',
  };
}

function responseFixture(output: Response['output'], incomplete = false): Response {
  return {
    id: 'resp_synthetic',
    object: 'response',
    created_at: 0,
    status: incomplete ? 'incomplete' : 'completed',
    model: 'gpt-5.5',
    error: null,
    incomplete_details: incomplete ? { reason: 'max_output_tokens' } : null,
    instructions: null,
    metadata: null,
    parallel_tool_calls: false,
    temperature: null,
    top_p: null,
    tool_choice: 'auto',
    tools: [],
    output_text: '',
    output,
  };
}

async function request(
  mode: (typeof modes)[number],
  tools: Tool[],
  output: Response['output'],
  incomplete = false,
) {
  const response = responseFixture(output, incomplete);
  const serializedTools = JSON.stringify(tools);
  const requests: { method: string | undefined; url: string | undefined; body: string }[] = [];
  const server = createServer((incoming, outgoing) => {
    const buffers: Buffer[] = [];
    incoming.on('data', (buffer: Buffer) => buffers.push(buffer));
    incoming.on('end', () => {
      requests.push({ method: incoming.method, url: incoming.url, body: Buffer.concat(buffers).toString() });
      if (mode === 'parse') {
        outgoing.writeHead(200, { 'content-type': 'application/json', connection: 'close' });
        outgoing.end(JSON.stringify(response));
      } else {
        const events: ResponseStreamEvent[] = [
          {
            type: 'response.created',
            sequence_number: 0,
            response: { ...response, status: 'in_progress', output: [] },
          },
          { type: incomplete ? 'response.incomplete' : 'response.completed', sequence_number: 1, response },
        ];
        outgoing.writeHead(200, { 'content-type': 'text/event-stream', connection: 'close' });
        outgoing.end(
          events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),
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
    const client = new OpenAI({
      apiKey: 'synthetic-namespace-key',
      baseURL: `http://127.0.0.1:${address.port}/v1`,
      maxRetries: 0,
      timeout: 5000,
      logLevel: 'off',
    });
    const params = { model: 'gpt-5.5', input: 'Look up Paris', tools };
    const parsed =
      mode === 'parse'
        ? await client.responses.parse(params)
        : await client.responses
            .stream(mode === 'replay' ? { response_id: response.id, tools } : params)
            .finalResponse();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      method: mode === 'replay' ? 'GET' : 'POST',
      url: mode === 'replay' ? '/v1/responses/resp_synthetic?stream=true' : '/v1/responses',
    });
    if (mode === 'replay') {
      expect(requests[0]?.body).toBe('');
    } else {
      const body = JSON.parse(requests[0]?.body ?? '');
      expect(body.tools).toEqual(JSON.parse(serializedTools));
      expect(Boolean(body.stream)).toBe(mode === 'stream');
    }
    expect(JSON.stringify(tools)).toBe(serializedTools);
    return parsed;
  } finally {
    if (server.listening) {
      const closed = once(server, 'close');
      server.close();
      server.closeAllConnections();
      await closed;
    }
  }
}

test.each(modes)('%s parses a strict function inside a namespace', async (mode) => {
  const result = await request(mode, [namespace('crm', [strictTool])], [toolCall('crm')]);
  expect(result.output[0]).toMatchObject({ namespace: 'crm', parsed_arguments: { city: 'Paris' } });
});

test.each(modes)('%s retains nested branded parsers and never executes their callbacks', async (mode) => {
  const callback = vi.fn();
  const parser = vi.fn((raw: string) => ({ transformed: raw }));
  const tool = makeParseableResponseTool({ ...strictTool, strict: false }, { parser, callback });
  const result = await request(mode, [namespace('crm', [tool])], [toolCall('crm')]);
  expect(result.output[0]).toMatchObject({ parsed_arguments: { transformed: '{"city":"Paris"}' } });
  expect(parser).toHaveBeenCalledTimes(1);
  expect(parser).toHaveBeenCalledWith('{"city":"Paris"}');
  expect(parser.mock.contexts[0]).toBe(tool);
  expect(callback).not.toHaveBeenCalled();
});

test.each(modes)('%s selects same-named tools by both namespace and name', async (mode) => {
  const scopes = ['crm', undefined, 'billing'] as const;
  const parsers = scopes.map((scope) => vi.fn(() => scope ?? 'top'));
  const tools = scopes.map((scope, index) => {
    const parser = parsers[index];
    if (!parser) {
      throw new Error('Expected a parser for each scope');
    }
    const tool = makeParseableResponseTool(strictTool, { parser, callback: undefined });
    Object.freeze(tool);
    return scope === undefined ? tool : namespace(scope, [tool]);
  });
  Object.freeze(tools);
  const result = await request(
    mode,
    tools,
    scopes.map((scope) => toolCall(scope)),
  );
  expect(result.output).toEqual(
    scopes.map((scope) => ({ ...toolCall(scope), parsed_arguments: scope ?? 'top' })),
  );
  for (const parser of parsers) {
    expect(parser).toHaveBeenCalledTimes(1);
    expect(parser).toHaveBeenCalledWith('{"city":"Paris"}');
  }
});

test.each(modes)('%s does not fall back across namespaces or from custom tools', async (mode) => {
  const parser = vi.fn(() => 'wrong tool');
  const top = makeParseableResponseTool(strictTool, { parser, callback: undefined });
  const calls = [toolCall('unknown'), toolCall('CRM'), toolCall('crm', 'absent'), toolCall('custom')];
  const tools = [
    top,
    namespace('crm', [strictTool]),
    namespace('custom', [{ type: 'custom', name: 'lookup' }]),
  ];
  const result = await request(mode, tools, calls);
  expect(result.output).toEqual(calls.map((call) => ({ ...call, parsed_arguments: null })));
  for (const call of calls) {
    expect(shouldParseToolCall({ model: 'gpt-5.5', tools }, call)).toBe(false);
  }
  expect(parser).not.toHaveBeenCalled();
});

test.each([false, null, undefined])(
  'does not infer strictness from a nested strict=%s tool',
  async (strict) => {
    const tools = [
      namespace('crm', [{ type: 'function', name: 'lookup', ...(strict === undefined ? {} : { strict }) }]),
    ];
    expect(hasAutoParseableInput({ model: 'gpt-5.5', tools })).toBe(false);
    expect(shouldParseToolCall({ model: 'gpt-5.5', tools }, toolCall('crm'))).toBe(false);
    const result = await request('parse', tools, [toolCall('crm', 'lookup', 'not JSON')]);
    expect(result.output[0]).toMatchObject({ parsed_arguments: null });
  },
);

test.each(modes)('%s leaves incomplete namespaced arguments unparsed', async (mode) => {
  const parser = vi.fn(JSON.parse);
  const branded = makeParseableResponseTool(strictTool, { parser, callback: undefined });
  const tools = [namespace('raw', [strictTool]), namespace('branded', [branded])];
  const calls = [toolCall('raw', 'lookup', '{"city":'), toolCall('branded', 'lookup', '{"city":')];
  const result = await request(mode, tools, calls, true);
  expect(result.status).toBe('incomplete');
  expect(result.incomplete_details).toEqual({ reason: 'max_output_tokens' });
  expect(result.output).toEqual(calls.map((call) => ({ ...call, parsed_arguments: null })));
  expect(parser).not.toHaveBeenCalled();
});

test.each(modes)('%s retains sanitized errors for malformed strict namespaced arguments', async (mode) => {
  await expect(
    request(mode, [namespace('crm', [strictTool])], [toolCall('crm', 'lookup', 'synthetic-private-text')]),
  ).rejects.toHaveProperty('message', 'Error reading response: invalid structured output JSON.');
});

test('accepts typed namespace functions whose optional parameters are absent', () => {
  const tools = [namespace('crm', [{ type: 'function', name: 'lookup', strict: true }])];
  const params = { model: 'gpt-5.5', tools };
  expect(hasAutoParseableInput(params)).toBe(true);
  expect(shouldParseToolCall(params, toolCall('crm'))).toBe(true);
  expect(parseResponse(responseFixture([toolCall('crm')]), params).output[0]).toMatchObject({
    parsed_arguments: { city: 'Paris' },
  });
});

test.each(['omitted', 'undefined', 'null', 'empty'] as const)(
  'keeps %s namespace behavior distinct',
  (kind) => {
    const call = toolCall();
    if (kind !== 'omitted') {
      // Exercise legacy runtime null despite the optional-string declaration.
      let value: string | null | undefined;
      if (kind === 'null') {
        value = null;
      } else if (kind === 'empty') {
        value = '';
      }
      Object.defineProperty(call, 'namespace', {
        value,
        enumerable: true,
      });
    }
    const params = {
      model: 'gpt-5.5',
      tools: [strictTool, namespace('', [{ ...strictTool, strict: false }])],
    };
    expect(shouldParseToolCall(params, call)).toBe(kind !== 'empty');
    expect(parseResponse(responseFixture([call]), params).output[0]).toMatchObject({
      parsed_arguments: kind === 'empty' ? null : { city: 'Paris' },
    });
  },
);

test('preserves the selected branded parser failure', () => {
  const parserFailure = new Error('Synthetic parser failure');
  const tool = makeParseableResponseTool(strictTool, {
    parser: () => {
      throw parserFailure;
    },
    callback: undefined,
  });
  let caught: unknown;
  try {
    parseResponse(responseFixture([toolCall('crm')]), {
      model: 'gpt-5.5',
      tools: [namespace('crm', [tool])],
    });
  } catch (error) {
    caught = error;
  }
  expect(caught).toBe(parserFailure);
});
