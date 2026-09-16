import OpenAI from 'openai';
import { standardResponsesFunction, standardTextFormat } from 'openai/helpers/standard-schema';
import { toResponseInputItem, toResponseInputItems } from 'openai/lib/responses/ResponseInputItems';
import type {
  Response as APIResponse,
  ResponseCreateParamsNonStreaming,
  ResponseInputItem,
} from 'openai/resources/responses/responses';

const text = '{"count":"42"}';
const schema = {
  type: 'object',
  properties: { count: { type: 'string' } },
  required: ['count'],
  additionalProperties: false,
};
const validator = {
  '~standard': {
    version: 1 as const,
    vendor: 'synthetic',
    validate: () => ({ value: 42n }),
  },
};

function makeResponse(kind: 'message' | 'function_call' | 'refusal'): APIResponse {
  return {
    id: 'resp_synthetic',
    object: 'response',
    created_at: 0,
    status: 'completed',
    error: null,
    incomplete_details: null,
    instructions: null,
    metadata: null,
    model: 'gpt-test',
    output_text: kind === 'message' ? text : '',
    output:
      kind === 'function_call'
        ? [
            {
              type: 'function_call',
              id: 'fc_synthetic',
              call_id: 'call_synthetic',
              name: 'counter',
              arguments: text,
              status: 'completed',
            },
          ]
        : [
            {
              type: 'message',
              id: 'msg_synthetic',
              role: 'assistant',
              status: 'completed',
              phase: 'final_answer',
              content:
                kind === 'message'
                  ? [{ type: 'output_text', text, annotations: [], logprobs: [] }]
                  : [{ type: 'refusal', refusal: 'No.' }],
            },
          ],
    parallel_tool_calls: true,
    temperature: null,
    top_p: null,
    tool_choice: 'auto',
    tools: [],
  };
}

describe.each(['parse', 'stream'] as const)('replaying %s response history', (mode) => {
  test.each(['message', 'function_call', 'refusal'] as const)(
    'omits parsed %s values from the next public request without changing the parsed response',
    async (kind) => {
      const response = makeResponse(kind);
      const requests: unknown[] = [];
      const client = new OpenAI({
        apiKey: 'synthetic-key',
        maxRetries: 0,
        fetch: async (_url, init) => {
          if (typeof init?.body !== 'string') {
            throw new TypeError('Expected a serialized response request');
          }
          requests.push(JSON.parse(init.body));
          if (mode === 'stream' && requests.length === 1) {
            const events = [
              {
                type: 'response.created',
                sequence_number: 0,
                response: { ...response, output: [], status: 'in_progress' },
              },
              { type: 'response.completed', sequence_number: 1, response },
            ];
            return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
              headers: { 'content-type': 'text/event-stream' },
            });
          }
          return Response.json(response);
        },
      });
      const params: Omit<ResponseCreateParamsNonStreaming, 'stream'> = {
        model: 'gpt-test',
        input: 'Count it.',
      };
      if (kind === 'message') {
        params.text = { format: standardTextFormat(validator, 'counter', { schema }) };
      } else if (kind === 'function_call') {
        params.tools = [standardResponsesFunction({ name: 'counter', parameters: validator, schema })];
      }
      const parsed =
        mode === 'parse'
          ? await client.responses.parse(params)
          : await client.responses.stream(params).finalResponse();
      const original = structuredClone(parsed.output);
      const input = toResponseInputItems(parsed.output);
      if (kind === 'function_call') {
        input.push({ type: 'function_call_output', call_id: 'call_synthetic', output: 'Done.' });
      }
      input.push({ role: 'user', content: 'Continue.' });

      await client.responses.create({ model: 'gpt-test', input });

      expect(requests).toHaveLength(2);
      expect(requests[1]).toEqual({ model: 'gpt-test', input: [...response.output, ...input.slice(1)] });
      expect(parsed.output).toEqual(original);
      const [item] = parsed.output;
      if (item?.type === 'message') {
        if (kind === 'refusal' && mode === 'parse') {
          expect(item.content[0]).not.toHaveProperty('parsed');
        } else {
          expect(item.content[0]).toHaveProperty('parsed', kind === 'refusal' ? null : 42n);
        }
      } else {
        expect(item).toHaveProperty('parsed_arguments', 42n);
      }
    },
  );
});

test('preserves unrelated fields and unchanged input identities while removing known output metadata', () => {
  const inputText = { type: 'input_text' as const, text: 'Keep it.', parsed: 'application metadata' };
  const inputImage = {
    type: 'input_image' as const,
    detail: 'auto' as const,
    image_url: 'https://example.invalid/synthetic.png',
    parsed: 'image metadata',
  };
  const outputText = { type: 'output_text' as const, text, annotations: [], parsed: null, future: false };
  const refusal = { type: 'refusal' as const, refusal: 'No.', parsed: null, future: 0 };
  const output = {
    type: 'message' as const,
    id: 'msg_synthetic',
    role: 'assistant' as const,
    status: 'completed' as const,
    phase: 'commentary' as const,
    content: [outputText, refusal],
    future: '',
  };
  const user: ResponseInputItem = { type: 'message', role: 'user', content: [inputText, inputImage] };
  const stringMessage = {
    type: 'message' as const,
    role: 'assistant' as const,
    content: 'Keep it.',
    id: 'input_synthetic',
  };
  const assistantInput = { ...user, role: 'assistant' as const, id: 'input_synthetic' };
  const normalized = toResponseInputItem(output);
  if (!normalized) {
    throw new Error('Expected replayable message history');
  }

  expect(normalized).toEqual({
    ...output,
    content: [
      { type: 'output_text', text, annotations: [], future: false },
      { type: 'refusal', refusal: 'No.', future: 0 },
    ],
  });
  expect(outputText).toHaveProperty('parsed', null);
  expect(refusal).toHaveProperty('parsed', null);
  expect(toResponseInputItem(user)).toBe(user);
  expect(toResponseInputItem(stringMessage)).toBe(stringMessage);
  expect(toResponseInputItem(assistantInput)).toBe(assistantInput);
  expect(toResponseInputItem(normalized)).toBe(normalized);

  const call = {
    type: 'function_call' as const,
    name: 'counter',
    call_id: 'call_synthetic',
    arguments: text,
    namespace: 'workspace',
    future: false,
  };
  expect(toResponseInputItem(call)).toBe(call);
  const parsedCall = { ...call, parsed_arguments: null };
  expect(toResponseInputItem(parsedCall)).toEqual(call);
});
