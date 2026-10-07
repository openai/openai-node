import OpenAI from 'openai';
import { zodResponsesFunction } from 'openai/helpers/zod';
import { standardResponsesFunction } from 'openai/helpers/standard-schema';
import { functionTool } from 'openai/lib/beta/agents/function-tool';
import { describe, expect, test, vi } from 'vitest';
import { z } from 'zod/v4';

const schema = z.object({ item_id: z.string() });
type Options = Parameters<typeof zodResponsesFunction<typeof schema>>[0];
const factories = [
  { name: 'Zod', create: (options: Options) => zodResponsesFunction(options) },
  { name: 'Standard Schema', create: (options: Options) => standardResponsesFunction(options) },
];

describe.each(factories)('$name deferred function tools', ({ create }) => {
  test.each([true, false, undefined])(
    'preserves defer_loading=%s with parsing and Agents composition',
    async (defer_loading) => {
      const execute = vi.fn(({ item_id }: { item_id: string }) => ({ item_id, price: '12.50' }));
      const tool = create({
        name: 'lookup_item',
        parameters: schema,
        function: execute,
        defer_loading,
      });
      const definition = {
        type: 'function',
        name: 'lookup_item',
        strict: true,
        parameters: {
          $schema: 'http://json-schema.org/draft-07/schema#',
          type: 'object',
          properties: { item_id: { type: 'string' } },
          required: ['item_id'],
          additionalProperties: false,
        },
        ...(defer_loading === undefined ? {} : { defer_loading }),
      };
      const calls: unknown[] = [];
      let arguments_ = '{"item_id":"ITEM_A"}';
      const client = new OpenAI({
        apiKey: 'synthetic-deferred-tool-key',
        maxRetries: 0,
        fetch: async (url, init) => {
          const request = new Request(url, init);
          const body = await request.json();
          calls.push(body);
          if (new URL(request.url).pathname.includes('/agents/sessions')) {
            return Response.json({ id: 'session_test', status: 'in_progress' });
          }
          const response = {
            id: 'resp_test',
            object: 'response',
            status: 'completed',
            output: [
              {
                type: 'function_call',
                id: 'fc_test',
                call_id: 'call_test',
                name: tool.name,
                ...(defer_loading ? { namespace: tool.name } : {}),
                arguments: arguments_,
                status: 'completed',
              },
            ],
          };
          if (!(typeof body === 'object' && body !== null && 'stream' in body && body.stream)) {
            return Response.json(response);
          }
          const [item] = response.output;
          const events = [
            {
              type: 'response.created',
              sequence_number: 0,
              response: { ...response, status: 'in_progress', output: [] },
            },
            {
              type: 'response.output_item.added',
              sequence_number: 1,
              output_index: 0,
              item: { ...item, arguments: '', status: 'in_progress' },
            },
            {
              type: 'response.function_call_arguments.delta',
              sequence_number: 2,
              output_index: 0,
              item_id: 'fc_test',
              delta: arguments_,
            },
            {
              type: 'response.function_call_arguments.done',
              sequence_number: 3,
              output_index: 0,
              item_id: 'fc_test',
              arguments: arguments_,
            },
            { type: 'response.output_item.done', sequence_number: 4, output_index: 0, item },
            { type: 'response.completed', sequence_number: 5, response },
          ];
          return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
            headers: { 'content-type': 'text/event-stream' },
          });
        },
      });
      const params = {
        model: 'model_test',
        input: 'Look up item ITEM_A.',
        tools: [{ type: 'tool_search' as const }, tool],
      };
      const responses = await Promise.all([
        client.responses.parse(params),
        client.responses.stream(params).finalResponse(),
      ]);
      for (const response of responses) {
        expect(response.output[0]).toMatchObject({
          type: 'function_call',
          parsed_arguments: { item_id: 'ITEM_A' },
        });
      }
      const request = {
        model: params.model,
        input: params.input,
        tools: [{ type: 'tool_search' }, definition],
      };
      expect(calls).toEqual([request, { ...request, stream: true }]);
      expect(execute).not.toHaveBeenCalled();
      arguments_ = '{"item_id":12}';
      await expect(client.responses.parse(params)).rejects.toThrow();
      await expect(client.responses.stream(params).finalResponse()).rejects.toThrow();

      const agentTool = functionTool(tool);
      await client.beta.agents.sessions.create({
        agent: { model: 'model_test', tools: [{ type: 'tool_search' }, agentTool.definition] },
        environment: { type: 'none' },
        input: 'Look up item ITEM_A.',
      });
      const { strict: _strict, ...agentDefinition } = definition;
      expect(calls[4]).toMatchObject({
        agent: { tools: [{ type: 'tool_search' }, { ...agentDefinition, description: '' }] },
      });
      expect(agentTool.definition).not.toHaveProperty('strict');
      expect(await agentTool.handler({ item_id: 'ITEM_A' })).toEqual({ item_id: 'ITEM_A', price: '12.50' });
      expect(execute).toHaveBeenCalledExactlyOnceWith({ item_id: 'ITEM_A' });
    },
  );
});
