import OpenAI from 'openai/index';
import { addOutputAsInput } from '../src/lib/ResponsesParser';

const openai = new OpenAI({ apiKey: 'example-api-key' });

describe('responses item types', () => {
  test('response output items are compatible with input items', async () => {
    expect(true).toBe(true);
  });

  test('output_as_input preserves reasoning/message order and normalizes computer outputs', () => {
    const response = {
      output: [
        { id: 'rs_1', type: 'reasoning', summary: [], status: 'completed' },
        {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: 'hello', annotations: [] }],
        },
        {
          id: 'cco_1',
          type: 'computer_call_output',
          call_id: 'call_1',
          output: { type: 'computer_screenshot', image_url: 'https://example.com/shot.png' },
          status: 'failed',
          created_by: 'assistant',
        },
      ],
    } as OpenAI.Responses.Response;

    addOutputAsInput(response);

    expect(response.output_as_input).toEqual([
      { id: 'rs_1', type: 'reasoning', summary: [], status: 'completed' },
      {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: 'hello', annotations: [] }],
      },
      {
        id: 'cco_1',
        type: 'computer_call_output',
        call_id: 'call_1',
        output: { type: 'computer_screenshot', image_url: 'https://example.com/shot.png' },
      },
    ]);
  });
});

const unused = async () => {
  const response = await openai.responses.create({
    model: 'gpt-5.1',
    input: 'You are a helpful assistant.',
  });
  await openai.responses.create({
    model: 'gpt-5.1',
    // check type compatibility for a replay-safe helper
    input: response.output_as_input,
  });
  expect(true).toBe(true);
};
