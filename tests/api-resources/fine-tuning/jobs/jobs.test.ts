// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import OpenAI from 'openai';
import { Response } from 'node-fetch';

const client = new OpenAI({
  apiKey: 'My API Key',
  baseURL: process.env['TEST_API_BASE_URL'] ?? 'http://127.0.0.1:4010',
});

describe('resource jobs', () => {
  test('create: only required params', async () => {
    const responsePromise = client.fineTuning.jobs.create({
      model: 'gpt-4o-mini',
      training_file: 'file-abc123',
    });
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('create: required and optional params', async () => {
    const response = await client.fineTuning.jobs.create({
      model: 'gpt-4o-mini',
      training_file: 'file-abc123',
      hyperparameters: { batch_size: 'auto', learning_rate_multiplier: 'auto', n_epochs: 'auto' },
      integrations: [
        {
          type: 'wandb',
          wandb: {
            project: 'my-wandb-project',
            entity: 'entity',
            name: 'name',
            tags: ['custom-tag', 'custom-tag', 'custom-tag'],
          },
        },
        {
          type: 'wandb',
          wandb: {
            project: 'my-wandb-project',
            entity: 'entity',
            name: 'name',
            tags: ['custom-tag', 'custom-tag', 'custom-tag'],
          },
        },
        {
          type: 'wandb',
          wandb: {
            project: 'my-wandb-project',
            entity: 'entity',
            name: 'name',
            tags: ['custom-tag', 'custom-tag', 'custom-tag'],
          },
        },
      ],
      seed: 42,
      suffix: 'x',
      validation_file: 'file-abc123',
    });
  });

  test('retrieve', async () => {
    const responsePromise = client.fineTuning.jobs.retrieve('ft-AF1WoRqd3aJAHsqc9NY7iL8F');
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('retrieve: request options instead of params are passed correctly', async () => {
    // ensure the request options are being passed correctly by passing an invalid HTTP method in order to cause an error
    await expect(
      client.fineTuning.jobs.retrieve('ft-AF1WoRqd3aJAHsqc9NY7iL8F', { path: '/_stainless_unknown_path' }),
    ).rejects.toThrow(OpenAI.NotFoundError);
  });

  test('list', async () => {
    const responsePromise = client.fineTuning.jobs.list();
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('list: request options instead of params are passed correctly', async () => {
    // ensure the request options are being passed correctly by passing an invalid HTTP method in order to cause an error
    await expect(client.fineTuning.jobs.list({ path: '/_stainless_unknown_path' })).rejects.toThrow(
      OpenAI.NotFoundError,
    );
  });

  test('list: request options and params are passed correctly', async () => {
    // ensure the request options are being passed correctly by passing an invalid HTTP method in order to cause an error
    await expect(
      client.fineTuning.jobs.list({ after: 'after', limit: 0 }, { path: '/_stainless_unknown_path' }),
    ).rejects.toThrow(OpenAI.NotFoundError);
  });

  test('cancel', async () => {
    const responsePromise = client.fineTuning.jobs.cancel('ft-AF1WoRqd3aJAHsqc9NY7iL8F');
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('cancel: request options instead of params are passed correctly', async () => {
    // ensure the request options are being passed correctly by passing an invalid HTTP method in order to cause an error
    await expect(
      client.fineTuning.jobs.cancel('ft-AF1WoRqd3aJAHsqc9NY7iL8F', { path: '/_stainless_unknown_path' }),
    ).rejects.toThrow(OpenAI.NotFoundError);
  });

  test('listEvents', async () => {
    const responsePromise = client.fineTuning.jobs.listEvents('ft-AF1WoRqd3aJAHsqc9NY7iL8F');
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('listEvents: request options instead of params are passed correctly', async () => {
    // ensure the request options are being passed correctly by passing an invalid HTTP method in order to cause an error
    await expect(
      client.fineTuning.jobs.listEvents('ft-AF1WoRqd3aJAHsqc9NY7iL8F', { path: '/_stainless_unknown_path' }),
    ).rejects.toThrow(OpenAI.NotFoundError);
  });

  test('listEvents: request options and params are passed correctly', async () => {
    // ensure the request options are being passed correctly by passing an invalid HTTP method in order to cause an error
    await expect(
      client.fineTuning.jobs.listEvents(
        'ft-AF1WoRqd3aJAHsqc9NY7iL8F',
        { after: 'after', limit: 0 },
        { path: '/_stainless_unknown_path' },
      ),
    ).rejects.toThrow(OpenAI.NotFoundError);
  });
});
