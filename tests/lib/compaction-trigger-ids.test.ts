import OpenAI from 'openai';
import type { ResponseInputItem } from 'openai/resources/responses/responses';
import type { BetaResponseInputItem } from 'openai/resources/beta/responses/responses';
import { expect, test } from 'vitest';

for (const beta of [false, true]) {
  for (const fields of [{}, { id: null }, { id: '' }, { id: 'msg_transport_compat' }]) {
    test(`${beta ? 'beta' : 'stable'} compaction ID ${JSON.stringify(fields)}`, async () => {
      const legacy: ResponseInputItem.CompactionTrigger = { type: 'compaction_trigger' };
      const trigger: BetaResponseInputItem.CompactionTrigger = {
        ...legacy,
        ...fields,
        ...(beta ? { agent: { agent_name: 'assistant' } } : {}),
      };
      const requests: Request[] = [];
      const client = new OpenAI({
        apiKey: 'synthetic-key',
        baseURL: 'https://example.invalid/v1',
        maxRetries: 0,
        fetch: async (input, init) => {
          const request = new Request(input, init);
          requests.push(request);
          expect(new URL(request.url).searchParams.get('beta')).toBe(beta ? 'true' : null);
          if (request.method === 'POST') {
            expect(new URL(request.url).pathname).toBe('/v1/responses');
            const body = await request.json();
            expect(body).toEqual(expect.objectContaining({ input: [trigger] }));
          } else {
            expect(request.method).toBe('GET');
            expect(new URL(request.url).pathname).toBe('/v1/responses/resp_compat');
          }
          return Response.json({
            id: 'resp_compat',
            object: 'response',
            instructions: [trigger],
            output: [],
          });
        },
      });
      const result = beta
        ? await client.beta.responses.retrieve('resp_compat')
        : await client.responses.retrieve('resp_compat');
      expect(Array.isArray(result.instructions)).toBe(true);
      if (!Array.isArray(result.instructions)) {
        throw new TypeError('Expected instructions list');
      }
      const [item] = result.instructions;
      if (item?.type !== 'compaction_trigger') {
        throw new Error('Expected compaction trigger');
      }
      expect(item.id).toBe('id' in fields ? fields.id : undefined);
      expect(Object.keys(item).includes('id')).toBe(Object.keys(fields).includes('id'));
      if (beta) {
        expect(item).toHaveProperty('agent.agent_name', 'assistant');
      }
      await (beta
        ? client.beta.responses.create({ model: 'gpt-4o', input: [trigger] })
        : client.responses.create({ model: 'gpt-4o', input: [trigger] }));
      expect(requests).toHaveLength(2);
    });
  }
}
