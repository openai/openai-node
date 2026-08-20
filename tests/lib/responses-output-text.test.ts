import OpenAI from 'openai';

describe('resource responses output_text', () => {
  const responseID = 'resp_677efb5139a88190b512bc3fef8e535d';

  test.each(['create', 'retrieve'] as const)('%s', async (method) => {
    const client = new OpenAI({
      apiKey: 'My API Key',
      fetch: async () => Response.json({ id: responseID, object: 'response', output: [] }),
    });
    const responsePromise =
      method === 'create' ? client.responses.create({}) : client.responses.retrieve(responseID);
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);

    expect(response).toHaveProperty('output_text');
    expect(typeof response.output_text).toBe('string');
  });
});
