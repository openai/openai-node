// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'My API Key',
  adminAPIKey: 'My Admin API Key',
  baseURL: process.env['TEST_API_BASE_URL'] ?? 'http://127.0.0.1:4010',
});

describe('resource usage', () => {
  test('audioSpeeches: only required params', async () => {
    const responsePromise = client.admin.organization.usage.audioSpeeches({ start_time: 0 });
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('audioSpeeches: required and optional params', async () => {
    const response = await client.admin.organization.usage.audioSpeeches({
      start_time: 0,
      api_key_ids: ['string'],
      bucket_width: '1m',
      end_time: 0,
      group_by: ['project_id'],
      limit: 0,
      models: ['string'],
      page: 'page',
      project_ids: ['string'],
      user_ids: ['string'],
    });
  });

  test('audioTranscriptions: only required params', async () => {
    const responsePromise = client.admin.organization.usage.audioTranscriptions({ start_time: 0 });
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('audioTranscriptions: required and optional params', async () => {
    const response = await client.admin.organization.usage.audioTranscriptions({
      start_time: 0,
      api_key_ids: ['string'],
      bucket_width: '1m',
      end_time: 0,
      group_by: ['project_id'],
      limit: 0,
      models: ['string'],
      page: 'page',
      project_ids: ['string'],
      user_ids: ['string'],
    });
  });

  test('codeInterpreterSessions: only required params', async () => {
    const responsePromise = client.admin.organization.usage.codeInterpreterSessions({ start_time: 0 });
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('codeInterpreterSessions: required and optional params', async () => {
    const response = await client.admin.organization.usage.codeInterpreterSessions({
      start_time: 0,
      bucket_width: '1m',
      end_time: 0,
      group_by: ['project_id'],
      limit: 0,
      page: 'page',
      project_ids: ['string'],
    });
  });

  test('completions: only required params', async () => {
    const responsePromise = client.admin.organization.usage.completions({ start_time: 0 });
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('completions: required and optional params', async () => {
    const response = await client.admin.organization.usage.completions({
      start_time: 0,
      api_key_ids: ['string'],
      batch: true,
      bucket_width: '1m',
      end_time: 0,
      group_by: ['project_id'],
      limit: 0,
      models: ['string'],
      page: 'page',
      project_ids: ['string'],
      user_ids: ['string'],
    });
  });

  test('costs: only required params', async () => {
    const responsePromise = client.admin.organization.usage.costs({ start_time: 0 });
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('costs: required and optional params', async () => {
    const response = await client.admin.organization.usage.costs({
      start_time: 0,
      api_key_ids: ['string'],
      bucket_width: '1d',
      end_time: 0,
      group_by: ['project_id'],
      limit: 0,
      page: 'page',
      project_ids: ['string'],
    });
  });

  test('embeddings: only required params', async () => {
    const responsePromise = client.admin.organization.usage.embeddings({ start_time: 0 });
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('embeddings: required and optional params', async () => {
    const response = await client.admin.organization.usage.embeddings({
      start_time: 0,
      api_key_ids: ['string'],
      bucket_width: '1m',
      end_time: 0,
      group_by: ['project_id'],
      limit: 0,
      models: ['string'],
      page: 'page',
      project_ids: ['string'],
      user_ids: ['string'],
    });
  });

  test('images: only required params', async () => {
    const responsePromise = client.admin.organization.usage.images({ start_time: 0 });
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('images: required and optional params', async () => {
    const response = await client.admin.organization.usage.images({
      start_time: 0,
      api_key_ids: ['string'],
      bucket_width: '1m',
      end_time: 0,
      group_by: ['project_id'],
      limit: 0,
      models: ['string'],
      page: 'page',
      project_ids: ['string'],
      sizes: ['256x256'],
      sources: ['image.generation'],
      user_ids: ['string'],
    });
  });

  test('moderations: only required params', async () => {
    const responsePromise = client.admin.organization.usage.moderations({ start_time: 0 });
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('moderations: required and optional params', async () => {
    const response = await client.admin.organization.usage.moderations({
      start_time: 0,
      api_key_ids: ['string'],
      bucket_width: '1m',
      end_time: 0,
      group_by: ['project_id'],
      limit: 0,
      models: ['string'],
      page: 'page',
      project_ids: ['string'],
      user_ids: ['string'],
    });
  });

  test('vectorStores: only required params', async () => {
    const responsePromise = client.admin.organization.usage.vectorStores({ start_time: 0 });
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('vectorStores: required and optional params', async () => {
    const response = await client.admin.organization.usage.vectorStores({
      start_time: 0,
      bucket_width: '1m',
      end_time: 0,
      group_by: ['project_id'],
      limit: 0,
      page: 'page',
      project_ids: ['string'],
    });
  });
});
