import OpenAI from 'openai';
import type { BetaCompactedResponse } from 'openai/resources/beta/responses/responses';
import type { CompactedResponse } from 'openai/resources/responses/responses';

// These annotations also check that both public output types accept retained inputs.
const output: CompactedResponse['output'] = [
  {
    id: 'msg_user',
    type: 'message',
    role: 'user',
    content: [{ type: 'input_text', text: 'Synthetic user input' }],
  },
  {
    id: 'msg_system',
    type: 'message',
    role: 'system',
    content: [{ type: 'input_text', text: 'Synthetic system input' }],
  },
  {
    id: 'msg_developer',
    type: 'message',
    role: 'developer',
    content: [{ type: 'input_text', text: 'Synthetic developer input' }],
  },
  {
    id: 'msg_assistant',
    type: 'message',
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text: 'Synthetic answer', annotations: [], logprobs: [] }],
  },
  { id: 'cmp_item', type: 'compaction', encrypted_content: 'fake-encrypted-content' },
];
const betaOutput: BetaCompactedResponse['output'] = output;

for (const surface of ['responses', 'beta.responses'] as const) {
  test(`${surface}.compact preserves retained messages and serializes them for repeated compaction`, async () => {
    const requests: { url: string; body: unknown }[] = [];
    const client = new OpenAI({
      apiKey: 'fake-test-key',
      maxRetries: 0,
      fetch: async (url, init) => {
        requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
        return Response.json({
          id: 'cmp_response',
          object: 'response.compaction',
          created_at: 1,
          output: surface === 'responses' ? output : betaOutput,
          usage: {
            input_tokens: 1,
            output_tokens: 1,
            total_tokens: 2,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens_details: { reasoning_tokens: 0 },
          },
        });
      },
    });
    const resource = surface === 'responses' ? client.responses : client.beta.responses;
    const result = await resource.compact({
      model: 'synthetic-model',
      input: [{ role: 'user', content: 'Synthetic input' }],
    });
    expect(result.output).toEqual(output);
    // Narrow to the item kinds in this fixture: the full response union also
    // contains variants not accepted by request input types.
    const input = result.output.map((item) => {
      if (item.type === 'message' || item.type === 'compaction') {
        return item;
      }
      throw new Error('Unexpected item kind in synthetic compaction response');
    });
    await resource.compact({ model: 'synthetic-model', input });
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual({
      url: `https://api.openai.com/v1/responses/compact${surface === 'beta.responses' ? '?beta=true' : ''}`,
      body: { model: 'synthetic-model', input: output },
    });
  });
}
