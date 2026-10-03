import OpenAI from 'openai';
import { standardTextFormat } from 'openai/helpers/standard-schema';
import { zodTextFormat } from 'openai/helpers/zod';
import type {
  Response as APIResponse,
  ResponseFormatTextJSONSchemaConfig,
  ResponseOutputMessage,
  ResponseStreamEvent,
} from 'openai/resources/responses/responses';
import { z as zv3 } from 'zod/v3';
import { z as zv4 } from 'zod/v4';

const format: ResponseFormatTextJSONSchemaConfig = {
  type: 'json_schema',
  name: 'answer',
  strict: true,
  schema: {
    type: 'object',
    properties: { answer: { type: 'string' } },
    required: ['answer'],
    additionalProperties: false,
  },
};

function message(text: string, phase?: ResponseOutputMessage['phase']): ResponseOutputMessage {
  return {
    id: `msg_${phase ?? 'legacy'}`,
    type: 'message',
    role: 'assistant',
    status: 'completed',
    ...(phase === undefined ? {} : { phase }),
    content: [{ type: 'output_text', text, annotations: [], logprobs: [] }],
  };
}

async function request(
  mode: 'parse' | 'stream',
  output: APIResponse['output'],
  textFormat = format,
  status: APIResponse['status'] = 'completed',
) {
  const response: APIResponse = {
    id: 'resp_synthetic',
    object: 'response',
    created_at: 0,
    status,
    model: 'gpt-5.5',
    error: null,
    incomplete_details: status === 'incomplete' ? { reason: 'max_output_tokens' } : null,
    instructions: null,
    metadata: null,
    parallel_tool_calls: false,
    temperature: null,
    top_p: null,
    tool_choice: 'auto',
    tools: [],
    output_text: output
      .flatMap((item) => (item.type === 'message' ? item.content : []))
      .flatMap((content) => (content.type === 'output_text' ? [content.text] : []))
      .join(''),
    output,
  };
  const client = new OpenAI({
    apiKey: 'test-key',
    fetch: async (_url, init) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        text: { format: textFormat },
      });
      if (mode === 'parse') {
        return Response.json(response);
      }
      const events: ResponseStreamEvent[] = [
        {
          type: 'response.created',
          sequence_number: 0,
          response: { ...response, status: 'in_progress', output: [] },
        },
        {
          type: status === 'incomplete' ? 'response.incomplete' : 'response.completed',
          sequence_number: 1,
          response,
        },
      ];
      return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
        headers: { 'content-type': 'text/event-stream' },
      });
    },
  });
  const params = { model: 'gpt-5.5', input: 'Answer briefly', text: { format: textFormat } };
  return mode === 'parse'
    ? await client.responses.parse(params)
    : await client.responses.stream(params).finalResponse();
}

describe.each(['parse', 'stream'] as const)('responses.%s message phases', (mode) => {
  test.each(['Let me check.', '{"answer":"intermediate"}'])(
    'skips commentary containing %s before the final answer',
    async (text) => {
      const commentary = message(text, 'commentary');
      const final = message('{"answer":"final"}', 'final_answer');
      const result = await request(mode, [commentary, final]);

      expect(result.output_parsed).toEqual({ answer: 'final' });
      expect(result.output_text).toBe(`${text}{"answer":"final"}`);
      expect(result.output).toEqual([
        { ...commentary, content: [{ ...commentary.content[0], parsed: null }] },
        { ...final, content: [{ ...final.content[0], parsed: { answer: 'final' } }] },
      ]);
      expect(commentary.content[0]).not.toHaveProperty('parsed');
    },
  );

  test.each([undefined, null, 'final_answer'] as const)('parses phase %s', async (phase) => {
    const result = await request(mode, [message('{"answer":"final"}', phase)]);
    expect(result.output_parsed).toEqual({ answer: 'final' });
  });

  test('leaves commentary without a final answer unparsed', async () => {
    const result = await request(mode, [message('{"answer":"intermediate"}', 'commentary')]);
    expect(result.output_parsed).toBeNull();
    expect(result.output[0]).toMatchObject({ content: [{ parsed: null }] });
  });

  test('skips unknown explicit phases', async () => {
    // SAFETY: Simulate a future wire phase that is not yet present in the generated union.
    const futurePhase = 'future_phase' as ResponseOutputMessage['phase'];
    const result = await request(mode, [
      message('Intermediate text', futurePhase),
      message('{"answer":"final"}', 'final_answer'),
    ]);
    expect(result.output_parsed).toEqual({ answer: 'final' });
    expect(result.output[0]).toMatchObject({ phase: futurePhase, content: [{ parsed: null }] });
  });

  test('still rejects invalid final JSON', async () => {
    await expect(request(mode, [message('not JSON', 'final_answer')])).rejects.toThrow(
      'invalid structured output JSON',
    );
  });

  test('keeps incomplete final output unparsed', async () => {
    const result = await request(mode, [message('{"answer":', 'final_answer')], format, 'incomplete');
    expect(result.output_parsed).toBeNull();
    expect(result.incomplete_details).toEqual({ reason: 'max_output_tokens' });
  });

  test('preserves final refusals after commentary', async () => {
    const final = message('', 'final_answer');
    final.content = [{ type: 'refusal', refusal: 'Cannot answer.' }];
    const result = await request(mode, [message('Let me check.', 'commentary'), final]);
    expect(result.output_parsed).toBeNull();
    expect(result.output[1]).toEqual(final);
  });

  test.each([
    ['Zod v3', zodTextFormat(zv3.object({ answer: zv3.string() }), 'answer')],
    ['Zod v4', zodTextFormat(zv4.object({ answer: zv4.string() }), 'answer')],
    [
      'Standard Schema',
      standardTextFormat(zv4.object({ answer: zv4.string() }), 'answer', { schema: format.schema }),
    ],
  ] as const)('preserves %s validation for final answers', async (_name, textFormat) => {
    const result = await request(
      mode,
      [message('Let me check.', 'commentary'), message('{"answer":"final"}', 'final_answer')],
      textFormat,
    );
    expect(result.output_parsed).toEqual({ answer: 'final' });
    await expect(request(mode, [message('{"answer":42}', 'final_answer')], textFormat)).rejects.toThrow();
  });
});
