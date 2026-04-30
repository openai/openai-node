// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'My API Key',
  adminAPIKey: 'My Admin API Key',
  baseURL: process.env['TEST_API_BASE_URL'] ?? 'http://127.0.0.1:4010',
});

describe('resource rateLimits', () => {
  test('listRateLimits', async () => {
    const responsePromise = client.admin.organization.projects.rateLimits.listRateLimits('project_id');
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('listRateLimits: request options and params are passed correctly', async () => {
    // ensure the request options are being passed correctly by passing an invalid HTTP method in order to cause an error
    await expect(
      client.admin.organization.projects.rateLimits.listRateLimits(
        'project_id',
        {
          after: 'after',
          before: 'before',
          limit: 0,
        },
        { path: '/_stainless_unknown_path' },
      ),
    ).rejects.toThrow(OpenAI.NotFoundError);
  });

  test('updateRateLimit: only required params', async () => {
    const responsePromise = client.admin.organization.projects.rateLimits.updateRateLimit('rate_limit_id', {
      project_id: 'project_id',
    });
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('updateRateLimit: required and optional params', async () => {
    const response = await client.admin.organization.projects.rateLimits.updateRateLimit('rate_limit_id', {
      project_id: 'project_id',
      batch_1_day_max_input_tokens: 0,
      max_audio_megabytes_per_1_minute: 0,
      max_images_per_1_minute: 0,
      max_requests_per_1_day: 0,
      max_requests_per_1_minute: 0,
      max_tokens_per_1_minute: 0,
    });
  });
});
