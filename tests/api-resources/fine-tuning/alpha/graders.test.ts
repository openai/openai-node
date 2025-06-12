// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'My API Key',
  baseURL: process.env['TEST_API_BASE_URL'] ?? 'http://127.0.0.1:4010',
});

describe('resource graders', () => {
  test('run: only required params', async () => {
    const responsePromise = client.fineTuning.alpha.graders.run({
      grader: { input: 'input', name: 'name', operation: 'eq', reference: 'reference', type: 'string_check' },
      model_sample: 'model_sample',
    });
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('run: required and optional params', async () => {
    const response = await client.fineTuning.alpha.graders.run({
      grader: { input: 'input', name: 'name', operation: 'eq', reference: 'reference', type: 'string_check' },
      model_sample: 'model_sample',
      item: {},
    });
  });

  test('validate: only required params', async () => {
    const responsePromise = client.fineTuning.alpha.graders.validate({
      grader: { input: 'input', name: 'name', operation: 'eq', reference: 'reference', type: 'string_check' },
    });
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('validate: required and optional params', async () => {
    const response = await client.fineTuning.alpha.graders.validate({
      grader: { input: 'input', name: 'name', operation: 'eq', reference: 'reference', type: 'string_check' },
    });
  });
});
