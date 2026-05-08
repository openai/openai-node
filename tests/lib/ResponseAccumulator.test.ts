import { accumulateResponse } from 'openai/lib/responses/ResponseAccumulator';

describe('ResponseAccumulator', () => {
  it('accumulates a final response snapshot from stream events', async () => {
    const createdResponse = {
      id: 'resp_123',
      object: 'response',
      created_at: 1,
      error: null,
      incomplete_details: null,
      instructions: null,
      metadata: null,
      model: 'gpt-5',
      output: [],
      output_text: '',
      parallel_tool_calls: false,
      status: 'in_progress',
      temperature: null,
      tool_choice: 'auto',
      tools: [],
      top_p: null,
      max_output_tokens: null,
      previous_response_id: null,
      reasoning: { effort: null, generate_summary: null, summary: null },
      service_tier: null,
      store: true,
      text: { format: { type: 'text' }, verbosity: null },
      truncation: 'disabled',
      usage: null,
      user: null,
    } as const;

    let snapshot = accumulateResponse({
      type: 'response.created',
      sequence_number: 0,
      response: createdResponse,
    });

    snapshot = accumulateResponse(
      {
        type: 'response.output_item.added',
        sequence_number: 1,
        output_index: 0,
        item: {
          id: 'msg_123',
          type: 'message',
          role: 'assistant',
          status: 'in_progress',
          content: [],
        },
      },
      snapshot,
    );

    snapshot = accumulateResponse(
      {
        type: 'response.content_part.added',
        sequence_number: 2,
        item_id: 'msg_123',
        output_index: 0,
        content_index: 0,
        part: {
          type: 'output_text',
          annotations: [],
          text: '',
        },
      },
      snapshot,
    );

    snapshot = accumulateResponse(
      {
        type: 'response.output_text.delta',
        sequence_number: 3,
        item_id: 'msg_123',
        output_index: 0,
        content_index: 0,
        delta: 'Hello world',
        logprobs: [],
      },
      snapshot,
    );

    snapshot = accumulateResponse(
      {
        type: 'response.completed',
        sequence_number: 4,
        response: {
          ...snapshot,
          output_text: 'Hello world',
          status: 'completed',
          output: [
            {
              ...snapshot.output[0],
              status: 'completed',
            },
          ],
        },
      },
      snapshot,
    );

    expect(snapshot.output_text).toBe('Hello world');
    expect(snapshot.output[0]).toMatchObject({
      type: 'message',
      content: [{ type: 'output_text', text: 'Hello world' }],
    });
  });
});
