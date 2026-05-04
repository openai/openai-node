import { parseResponse } from '../../src/lib/ResponsesParser';
import type { Response, ResponseCreateParamsBase } from '../../src/resources/responses/responses';

const structuredTextParams = {
  model: 'gpt-5.4-mini',
  input: 'Good large pea',
  text: {
    format: {
      type: 'json_schema',
      name: 'pea_schema',
      schema: { type: 'object' },
    },
  },
} as ResponseCreateParamsBase;

function makeResponse(status: Response['status'], text: string): Response {
  return {
    id: 'resp_123',
    created_at: 0,
    error: null,
    incomplete_details: status === 'incomplete' ? { reason: 'max_output_tokens' } : null,
    instructions: null,
    metadata: null,
    model: 'gpt-5.4-mini',
    object: 'response',
    output: [
      {
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        status,
        content: [
          {
            type: 'output_text',
            annotations: [],
            logprobs: [],
            text,
          },
        ],
      },
    ],
    output_text: text,
    parallel_tool_calls: true,
    temperature: null,
    tool_choice: 'auto',
    tools: [],
    top_p: null,
    status,
  } as Response;
}

describe('ResponsesParser', () => {
  it('parses structured output for completed responses', () => {
    const response = parseResponse(
      makeResponse('completed', '{"size":"large","quality":"good"}'),
      structuredTextParams,
    );

    expect(response.output_parsed).toEqual({ size: 'large', quality: 'good' });
  });

  it('leaves incomplete structured output unparsed so incomplete_details remain inspectable', () => {
    const response = parseResponse(
      makeResponse('incomplete', '{"size":"large","quality":"good","pea_description":"unterminated'),
      structuredTextParams,
    );

    expect(response.status).toBe('incomplete');
    expect(response.incomplete_details).toEqual({ reason: 'max_output_tokens' });
    expect(response.output_parsed).toBeNull();
    expect(response.output[0]?.type).toBe('message');
    if (response.output[0]?.type === 'message') {
      expect(response.output[0].content[0]).toMatchObject({
        type: 'output_text',
        parsed: null,
      });
    }
  });
});
