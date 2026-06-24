// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'My API Key',
  adminAPIKey: 'My Admin API Key',
  baseURL: process.env['TEST_API_BASE_URL'] ?? 'http://127.0.0.1:4010',
});

describe('resource spendAlerts', () => {
  test('create: only required params', async () => {
    const responsePromise = client.admin.organization.spendAlerts.create({
      currency: 'USD',
      interval: 'month',
      notification_channel: { recipients: ['string'], type: 'email' },
      threshold_amount: 0,
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
    const response = await client.admin.organization.spendAlerts.create({
      currency: 'USD',
      interval: 'month',
      notification_channel: {
        recipients: ['string'],
        type: 'email',
        subject_prefix: 'subject_prefix',
      },
      threshold_amount: 0,
    });
  });

  test('retrieve', async () => {
    const responsePromise = client.admin.organization.spendAlerts.retrieve('alert_id');
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('update: only required params', async () => {
    const responsePromise = client.admin.organization.spendAlerts.update('alert_id', {
      currency: 'USD',
      interval: 'month',
      notification_channel: { recipients: ['string'], type: 'email' },
      threshold_amount: 0,
    });
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('update: required and optional params', async () => {
    const response = await client.admin.organization.spendAlerts.update('alert_id', {
      currency: 'USD',
      interval: 'month',
      notification_channel: {
        recipients: ['string'],
        type: 'email',
        subject_prefix: 'subject_prefix',
      },
      threshold_amount: 0,
    });
  });

  test('list', async () => {
    const responsePromise = client.admin.organization.spendAlerts.list();
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('list: request options and params are passed correctly', async () => {
    // ensure the request options are being passed correctly by passing an invalid HTTP method in order to cause an error
    await expect(
      client.admin.organization.spendAlerts.list(
        {
          after: 'after',
          before: 'before',
          limit: 0,
          order: 'asc',
        },
        { path: '/_stainless_unknown_path' },
      ),
    ).rejects.toThrow(OpenAI.NotFoundError);
  });

  test('delete', async () => {
    const responsePromise = client.admin.organization.spendAlerts.delete('alert_id');
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });
});
