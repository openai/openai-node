import OpenAI from 'openai';
import { standardTextFormat } from 'openai/helpers/standard-schema';
import { zodTextFormat } from 'openai/helpers/zod';
import type { Response as APIResponse } from 'openai/resources/responses/responses';
import { z as v3 } from 'zod/v3';
import { z as v4 } from 'zod/v4';

const formats = [
  zodTextFormat(v3.object({ answer: v3.string() }), 'answer'),
  zodTextFormat(v4.object({ answer: v4.string() }), 'answer'),
  standardTextFormat(v4.object({ answer: v4.string() }), 'answer'),
] as const;

// Wire fixtures deliberately allow phases newer than the generated SDK union.
function wireMessage(id: string, text: string, phase?: string | null) {
  return {
    id,
    type: 'message',
    role: 'assistant',
    status: 'completed',
    ...(phase === undefined ? {} : { phase }),
    content: [{ type: 'output_text', text, annotations: [], logprobs: [] }],
  };
}

async function parseWire(
  mode: 'parse' | 'stream' | 'replay',
  output: ReturnType<typeof wireMessage>[],
  format = formats[0],
  incomplete = false,
) {
  const envelope = {
    id: 'resp_phase_test',
    access_programs: null,
    object: 'response',
    created_at: 0,
    status: incomplete ? 'incomplete' : 'completed',
    error: null,
    incomplete_details: incomplete ? { reason: 'max_output_tokens' } : null,
    model: 'gpt-5.5',
    instructions: null,
    metadata: null,
    parallel_tool_calls: false,
    temperature: null,
    top_p: null,
    tool_choice: 'auto',
    tools: [],
    output_text: '',
    output: [],
  } satisfies APIResponse;
  const response = {
    ...envelope,
    output,
    output_text: output.flatMap((item) => item.content.map((part) => part.text)).join(''),
  };
  const client = new OpenAI({
    apiKey: 'synthetic-key',
    fetch: async (_url, init) => {
      if (mode !== 'replay') {
        expect(JSON.parse(String(init?.body))).toMatchObject({ text: { format } });
      }
      if (mode === 'parse') {
        return Response.json(response);
      }
      const events: object[] = [
        { type: 'response.created', response: { ...envelope, status: 'in_progress' } },
      ];
      for (const [output_index, item] of output.entries()) {
        events.push({
          type: 'response.output_item.added',
          output_index,
          item: { ...item, status: 'in_progress', content: [] },
        });
        for (const [content_index, part] of item.content.entries()) {
          const position = { item_id: item.id, output_index, content_index };
          events.push(
            { type: 'response.content_part.added', ...position, part: { ...part, text: '' } },
            { type: 'response.output_text.delta', ...position, delta: part.text, logprobs: [] },
            { type: 'response.output_text.done', ...position, text: part.text, logprobs: [] },
            { type: 'response.content_part.done', ...position, part },
          );
        }
        events.push({ type: 'response.output_item.done', output_index, item });
      }
      events.push({ type: incomplete ? 'response.incomplete' : 'response.completed', response });
      return new Response(
        events
          .map((event, sequence_number) => `data: ${JSON.stringify({ ...event, sequence_number })}\n\n`)
          .join(''),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
  });
  const params = { model: 'gpt-5.5', input: 'Give an answer', text: { format } };
  if (mode === 'parse') {
    return client.responses.parse(params);
  }
  return client.responses
    .stream(mode === 'replay' ? { response_id: response.id, text: params.text } : params)
    .finalResponse();
}

describe.each(['parse', 'stream', 'replay'] as const)('Responses final phase via %s', (mode) => {
  test.each(['Checking the result.', '{"answer":"intermediate"}'])(
    'ignores commentary %s while preserving its text and metadata',
    async (text) => {
      const output = [
        wireMessage('msg_before', text, 'commentary'),
        wireMessage('msg_final', '{"answer":"final"}', 'final_answer'),
        wireMessage('msg_after', text, 'commentary'),
      ];
      const response = await parseWire(mode, output);
      expect(response.output_parsed).toEqual({ answer: 'final' });
      expect(response.output).toEqual(
        output.map((item) => ({
          ...item,
          content: item.content.map((part) => ({
            ...part,
            parsed: item.phase === 'final_answer' ? { answer: 'final' } : null,
          })),
        })),
      );
      expect(response.output_text).toBe(`${text}{"answer":"final"}${text}`);
    },
  );

  test.each(['commentary', 'future_phase'])('leaves a lone %s message unparsed', async (phase) => {
    const response = await parseWire(mode, [wireMessage('msg_only', 'Not structured JSON', phase)]);
    expect(response.output_parsed).toBeNull();
    expect(response.output[0]).toMatchObject({ phase, content: [{ parsed: null }] });
  });

  test.each([undefined, null, 'final_answer'])(
    'retains parsing and validation for phase %s',
    async (phase) => {
      await Promise.all(
        formats.map(async (format) => {
          const response = await parseWire(
            mode,
            [wireMessage('msg_final', '{"answer":"ok"}', phase)],
            format,
          );
          expect(response.output_parsed).toEqual({ answer: 'ok' });
          await expect(
            parseWire(mode, [wireMessage('msg_invalid', '{"answer":42}', phase)], format),
          ).rejects.toThrow();
        }),
      );
    },
  );

  test('leaves incomplete final text unparsed', async () => {
    const response = await parseWire(
      mode,
      [wireMessage('msg_final', '{"answer":', 'final_answer')],
      formats[0],
      true,
    );
    expect(response.output_parsed).toBeNull();
    expect(response.incomplete_details).toEqual({ reason: 'max_output_tokens' });
  });
});
