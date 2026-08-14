import { accumulateResponse } from 'openai/lib/responses/ResponseAccumulator';
import type {
  Response,
  ResponseOutputMessage,
  ResponseStreamEvent,
} from 'openai/resources/responses/responses';

function message(index: number, value: string): ResponseOutputMessage {
  return {
    id: `msg_${index}`,
    type: 'message',
    role: 'assistant',
    status: 'in_progress',
    content: [{ type: 'output_text', text: value, annotations: [] }],
  };
}

function delta(value: string): ResponseStreamEvent {
  return {
    type: 'response.output_text.delta',
    sequence_number: 1,
    item_id: 'msg_0',
    output_index: 0,
    content_index: 0,
    delta: value,
    logprobs: [],
  };
}

function snapshot(): Response {
  const initial = accumulateResponse({
    type: 'response.created',
    sequence_number: 0,
    response: {
      id: 'resp_123',
      object: 'response',
      created_at: 1,
      error: null,
      incomplete_details: null,
      instructions: null,
      metadata: null,
      model: 'gpt-5',
      output: [message(0, 'A')],
      output_text: 'A',
      parallel_tool_calls: false,
      status: 'in_progress',
      temperature: null,
      tool_choice: 'auto',
      tools: [],
      top_p: null,
    } as Response,
  });

  return accumulateResponse(delta('X'), initial);
}

function setText(response: Response, value: string): void {
  const [output] = response.output;
  if (output?.type !== 'message') {
    throw new Error('expected message output');
  }
  const [content] = output.content;
  if (content?.type !== 'output_text') {
    throw new Error('expected output text');
  }
  content.text = value;
}

describe('public response accumulator snapshots', () => {
  test.each([
    {
      label: 'the aggregate is overwritten',
      mutate: (response: Response) => {
        response.output_text = 'corrupted';
      },
      expected: 'AXY',
    },
    {
      label: 'content is replaced with text of the same length',
      mutate: (response: Response) => setText(response, 'ZZ'),
      expected: 'ZZY',
    },
    {
      label: 'content is replaced with text of a different length',
      mutate: (response: Response) => setText(response, 'longer'),
      expected: 'longerY',
    },
    {
      label: 'an existing output is replaced',
      mutate: (response: Response) => {
        response.output[0] = message(0, 'B');
      },
      expected: 'BY',
    },
    {
      label: 'another output is appended',
      mutate: (response: Response) => {
        response.output.push(message(1, 'B'));
      },
      expected: 'AXYB',
    },
  ])('recanonicalizes after $label between calls', ({ mutate, expected }) => {
    const current = snapshot();
    expect(current.output_text).toBe('AX');

    mutate(current);

    expect(accumulateResponse(delta('Y'), current)).toBe(current);
    expect(current.output_text).toBe(expected);
  });

  test('keeps ordinary direct accumulation in place', () => {
    const current = snapshot();

    expect(accumulateResponse(delta('Y'), current)).toBe(current);
    expect(current.output_text).toBe('AXY');
    expect(current.output[0]).toMatchObject({ content: [{ type: 'output_text', text: 'AXY' }] });
  });
});
