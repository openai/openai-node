// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import OpenAI from 'openai';
import { Response } from 'node-fetch';

const client = new OpenAI({
  apiKey: 'My API Key',
  baseURL: process.env['TEST_API_BASE_URL'] ?? 'http://127.0.0.1:4010',
});

describe('resource evals', () => {
  test('create: only required params', async () => {
    const responsePromise = client.evals.create({
      data_source_config: {
        item_schema: {
          '0': 'bar',
          '1': 'bar',
          '2': 'bar',
          '3': 'bar',
          '4': 'bar',
          '5': 'bar',
          '6': 'bar',
          '7': 'bar',
          '8': 'bar',
          '9': 'bar',
          '10': 'bar',
          '11': 'bar',
          '12': 'bar',
          '13': 'bar',
          '14': 'bar',
          '15': 'bar',
          '16': 'bar',
          '17': 'bar',
          '18': 'bar',
          '19': 'bar',
          '20': 'bar',
          '21': 'bar',
          '22': 'bar',
          '23': 'bar',
          '24': 'bar',
          '25': 'bar',
          '26': 'bar',
          '27': 'bar',
          '28': 'bar',
          '29': 'bar',
          '30': 'bar',
          '31': 'bar',
          '32': 'bar',
          '33': 'bar',
          '34': 'bar',
          '35': 'bar',
          '36': 'bar',
          '37': 'bar',
          '38': 'bar',
          '39': 'bar',
          '40': 'bar',
          '41': 'bar',
          '42': 'bar',
          '43': 'bar',
          '44': 'bar',
          '45': 'bar',
          '46': 'bar',
          '47': 'bar',
          '48': 'bar',
          '49': 'bar',
          '50': 'bar',
          '51': 'bar',
          '52': 'bar',
          '53': 'bar',
          '54': 'bar',
          '55': 'bar',
          '56': 'bar',
          '57': 'bar',
          '58': 'bar',
          '59': 'bar',
          '60': 'bar',
          '61': 'bar',
          '62': 'bar',
          '63': 'bar',
          '64': 'bar',
          '65': 'bar',
          '66': 'bar',
          '67': 'bar',
          '68': 'bar',
          '69': 'bar',
          '70': 'bar',
          '71': 'bar',
          '72': 'bar',
          '73': 'bar',
          '74': 'bar',
          '75': 'bar',
          '76': 'bar',
          '77': 'bar',
          '78': 'bar',
          '79': 'bar',
          '80': 'bar',
          '81': 'bar',
          '82': 'bar',
          '83': 'bar',
          '84': 'bar',
          '85': 'bar',
          '86': 'bar',
          '87': 'bar',
          '88': 'bar',
          '89': 'bar',
          '90': 'bar',
          '91': 'bar',
          '92': 'bar',
          '93': 'bar',
          '94': 'bar',
          '95': 'bar',
          '96': 'bar',
          '97': 'bar',
          '98': 'bar',
          '99': 'bar',
          '100': 'bar',
          '101': 'bar',
          '102': 'bar',
          '103': 'bar',
          '104': 'bar',
          '105': 'bar',
          '106': 'bar',
          '107': 'bar',
          '108': 'bar',
          '109': 'bar',
          '110': 'bar',
          '111': 'bar',
          '112': 'bar',
          '113': 'bar',
          '114': 'bar',
          '115': 'bar',
          '116': 'bar',
          '117': 'bar',
          '118': 'bar',
          '119': 'bar',
          '120': 'bar',
          '121': 'bar',
          '122': 'bar',
          '123': 'bar',
          '124': 'bar',
          '125': 'bar',
          '126': 'bar',
          '127': 'bar',
          '128': 'bar',
          '129': 'bar',
          '130': 'bar',
          '131': 'bar',
          '132': 'bar',
          '133': 'bar',
          '134': 'bar',
          '135': 'bar',
          '136': 'bar',
          '137': 'bar',
          '138': 'bar',
          '139': 'bar',
        },
        type: 'custom',
      },
      testing_criteria: [
        {
          input: [{ content: 'content', role: 'role' }],
          labels: ['string'],
          model: 'model',
          name: 'name',
          passing_labels: ['string'],
          type: 'label_model',
        },
      ],
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
    const response = await client.evals.create({
      data_source_config: {
        item_schema: {
          '0': 'bar',
          '1': 'bar',
          '2': 'bar',
          '3': 'bar',
          '4': 'bar',
          '5': 'bar',
          '6': 'bar',
          '7': 'bar',
          '8': 'bar',
          '9': 'bar',
          '10': 'bar',
          '11': 'bar',
          '12': 'bar',
          '13': 'bar',
          '14': 'bar',
          '15': 'bar',
          '16': 'bar',
          '17': 'bar',
          '18': 'bar',
          '19': 'bar',
          '20': 'bar',
          '21': 'bar',
          '22': 'bar',
          '23': 'bar',
          '24': 'bar',
          '25': 'bar',
          '26': 'bar',
          '27': 'bar',
          '28': 'bar',
          '29': 'bar',
          '30': 'bar',
          '31': 'bar',
          '32': 'bar',
          '33': 'bar',
          '34': 'bar',
          '35': 'bar',
          '36': 'bar',
          '37': 'bar',
          '38': 'bar',
          '39': 'bar',
          '40': 'bar',
          '41': 'bar',
          '42': 'bar',
          '43': 'bar',
          '44': 'bar',
          '45': 'bar',
          '46': 'bar',
          '47': 'bar',
          '48': 'bar',
          '49': 'bar',
          '50': 'bar',
          '51': 'bar',
          '52': 'bar',
          '53': 'bar',
          '54': 'bar',
          '55': 'bar',
          '56': 'bar',
          '57': 'bar',
          '58': 'bar',
          '59': 'bar',
          '60': 'bar',
          '61': 'bar',
          '62': 'bar',
          '63': 'bar',
          '64': 'bar',
          '65': 'bar',
          '66': 'bar',
          '67': 'bar',
          '68': 'bar',
          '69': 'bar',
          '70': 'bar',
          '71': 'bar',
          '72': 'bar',
          '73': 'bar',
          '74': 'bar',
          '75': 'bar',
          '76': 'bar',
          '77': 'bar',
          '78': 'bar',
          '79': 'bar',
          '80': 'bar',
          '81': 'bar',
          '82': 'bar',
          '83': 'bar',
          '84': 'bar',
          '85': 'bar',
          '86': 'bar',
          '87': 'bar',
          '88': 'bar',
          '89': 'bar',
          '90': 'bar',
          '91': 'bar',
          '92': 'bar',
          '93': 'bar',
          '94': 'bar',
          '95': 'bar',
          '96': 'bar',
          '97': 'bar',
          '98': 'bar',
          '99': 'bar',
          '100': 'bar',
          '101': 'bar',
          '102': 'bar',
          '103': 'bar',
          '104': 'bar',
          '105': 'bar',
          '106': 'bar',
          '107': 'bar',
          '108': 'bar',
          '109': 'bar',
          '110': 'bar',
          '111': 'bar',
          '112': 'bar',
          '113': 'bar',
          '114': 'bar',
          '115': 'bar',
          '116': 'bar',
          '117': 'bar',
          '118': 'bar',
          '119': 'bar',
          '120': 'bar',
          '121': 'bar',
          '122': 'bar',
          '123': 'bar',
          '124': 'bar',
          '125': 'bar',
          '126': 'bar',
          '127': 'bar',
          '128': 'bar',
          '129': 'bar',
          '130': 'bar',
          '131': 'bar',
          '132': 'bar',
          '133': 'bar',
          '134': 'bar',
          '135': 'bar',
          '136': 'bar',
          '137': 'bar',
          '138': 'bar',
          '139': 'bar',
        },
        type: 'custom',
        include_sample_schema: true,
      },
      testing_criteria: [
        {
          input: [{ content: 'content', role: 'role' }],
          labels: ['string'],
          model: 'model',
          name: 'name',
          passing_labels: ['string'],
          type: 'label_model',
        },
      ],
      metadata: { foo: 'string' },
      name: 'name',
      share_with_openai: true,
    });
  });

  test('retrieve', async () => {
    const responsePromise = client.evals.retrieve('eval_id');
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
    await expect(client.evals.retrieve('eval_id', { path: '/_stainless_unknown_path' })).rejects.toThrow(
      OpenAI.NotFoundError,
    );
  });

  test('update', async () => {
    const responsePromise = client.evals.update('eval_id', {});
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('list', async () => {
    const responsePromise = client.evals.list();
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
    await expect(client.evals.list({ path: '/_stainless_unknown_path' })).rejects.toThrow(
      OpenAI.NotFoundError,
    );
  });

  test('list: request options and params are passed correctly', async () => {
    // ensure the request options are being passed correctly by passing an invalid HTTP method in order to cause an error
    await expect(
      client.evals.list(
        { after: 'after', limit: 0, order: 'asc', order_by: 'created_at' },
        { path: '/_stainless_unknown_path' },
      ),
    ).rejects.toThrow(OpenAI.NotFoundError);
  });

  test('del', async () => {
    const responsePromise = client.evals.del('eval_id');
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('del: request options instead of params are passed correctly', async () => {
    // ensure the request options are being passed correctly by passing an invalid HTTP method in order to cause an error
    await expect(client.evals.del('eval_id', { path: '/_stainless_unknown_path' })).rejects.toThrow(
      OpenAI.NotFoundError,
    );
  });
});
